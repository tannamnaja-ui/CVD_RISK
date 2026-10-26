/**
 * HOSxP SQL — ported from the "approve icd10" project (server.js).
 * The BMS /api/sql endpoint takes a raw SQL string (no bound parameters), so every value
 * inlined here is validated or reduced to a safe character set first.
 */

export type Dialect = 'postgresql' | 'mysql';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VN_RE = /^[0-9A-Za-z-]{1,20}$/;

export function sqlDate(value: string): string {
  if (!DATE_RE.test(value)) throw new Error(`รูปแบบวันที่ไม่ถูกต้อง: ${value}`);
  return `'${value}'`;
}

export function sqlVn(value: string): string {
  if (!VN_RE.test(value)) throw new Error(`VN ไม่ถูกต้อง: ${value}`);
  return `'${value}'`;
}

/** Bytes that are invalid in WIN874 and break PostgreSQL text conversion — stripped from free-text columns. */
const WIN874_BAD_BYTES = [
  0x81, 0x82, 0x83, 0x84, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e,
  0x9f, 0xdb, 0xdc, 0xdd, 0xde, 0xfc, 0xfd, 0xfe, 0xff,
];
const WIN874_BAD_SQL = WIN874_BAD_BYTES.map((b) => `chr(${b})`).join('||');

/**
 * The BMS API takes SQL in the URL, so the bad-byte list is defined once in a one-row subquery
 * (joined as `w874`) instead of being repeated for every column — that alone was ~4 KB of URL.
 */
export const win874Join = (d: Dialect) => (d === 'mysql' ? '' : `CROSS JOIN (SELECT ${WIN874_BAD_SQL} AS bad) w874`);

/** Wrap a user-typed text column (needs win874Join in FROM). MySQL stores utf8 already, so it needs nothing. */
export function safeText(d: Dialect, expr: string): string {
  return d === 'mysql' ? expr : `translate(${expr}, w874.bad, '')`;
}

/** string_agg (PostgreSQL) / GROUP_CONCAT (MySQL). */
function agg(d: Dialect, expr: string, sep: string, distinct = false): string {
  const dist = distinct ? 'DISTINCT ' : '';
  return d === 'mysql' ? `GROUP_CONCAT(${dist}${expr} SEPARATOR '${sep}')` : `string_agg(${dist}${expr}, '${sep}')`;
}

export const hospitalSql = () => 'SELECT hospitalname FROM opdconfig LIMIT 1';

const AGE_TEXT = "concat(v.age_y,' ','ปี',' ',v.age_m,' ','ด',' ',v.age_d,' ','ว')";

/**
 * Visit list for a date range (port of GET /api/patients). One row per VN.
 * Contains no protected personal fields (patient / doctor names), so the BMS API runs it
 * without an authorization request; names come separately from patientNamesSql.
 */
export interface ListQueryOptions {
  /** strip WIN874-invalid bytes from text columns (needs the w874 cross join) */
  sanitize?: boolean;
  /** department-queue subquery used by the room filter */
  depList?: boolean;
}

/** Fallback ladder tried in order when the full list query fails on a given server. */
export const LIST_QUERY_VARIANTS: { options: ListQueryOptions; label: string }[] = [
  { options: { sanitize: true, depList: true }, label: 'แบบเต็ม' },
  { options: { sanitize: false, depList: true }, label: 'ไม่กรองอักขระ WIN874' },
  { options: { sanitize: false, depList: false }, label: 'ไม่กรองอักขระ WIN874 และไม่ดึงคิวห้องตรวจ' },
];

export function patientsSql(d: Dialect, dateFrom: string, dateTo: string, options: ListQueryOptions = {}): string {
  const { sanitize = true, depList = true } = options;
  const text = (expr: string) => (sanitize ? safeText(d, expr) : expr);
  return `
    SELECT o.vstdate, o.vsttime, o.vn
      ,o.hn
      ,${AGE_TEXT} as age
      ,v.age_y
      ,p.sex
      ,v.pdx
      ,${text('oq.dx_text_list')} as dx_text_list
      ,${text('s.name')} as spclty
      ,${text('k.department')} as department
      ,TRIM(o.main_dep) as depcode
      ${depList ? `,(SELECT ${agg(d, 'TRIM(dq.depcode)', ',', true)} FROM opd_dep_queue dq WHERE dq.vn = o.vn) as dep_list` : ''}
      ,${text('pt.name')} as pttype
    FROM ovst o
    ${sanitize ? win874Join(d) : ''}
    left outer join patient p on p.hn=o.hn
    left outer join vn_stat v on v.vn=o.vn
    left outer join ovst_seq oq on oq.vn=o.vn
    left outer join spclty s on s.spclty=o.spclty
    left outer join kskdepartment k on k.depcode=o.main_dep
    left outer join pttype pt on pt.pttype=o.pttype
    WHERE o.vstdate BETWEEN ${sqlDate(dateFrom)} AND ${sqlDate(dateTo)}
    ORDER BY o.vstdate, o.vsttime`;
}

/**
 * Patient and doctor names for the same date range. These are protected fields: the BMS API
 * only runs this after the user approves the authorization request it issues.
 */
export function patientNamesSql(d: Dialect, dateFrom: string, dateTo: string, sanitize = true): string {
  const text = (expr: string) => (sanitize ? safeText(d, expr) : expr);
  return `
    SELECT o.vn
      ,${text("concat(p.pname,p.fname,'  ',p.lname)")} as ptname
      ,${text("concat(dr.code,'-',dr.name,'(',dr.licenseno,')')")} as doctor
    FROM ovst o
    ${sanitize ? win874Join(d) : ''}
    left outer join patient p on p.hn=o.hn
    left outer join doctor dr on dr.code=o.doctor
    WHERE o.vstdate BETWEEN ${sqlDate(dateFrom)} AND ${sqlDate(dateTo)}
    ORDER BY o.vstdate, o.vsttime`;
}

/** ICD-10 prefixes (stored without dots in HOSxP) that mark a major CV risk factor. */
export const RISK_ICD = {
  dm: ['E10', 'E11', 'E12', 'E13', 'E14'],
  ht: ['I10', 'I11', 'I12', 'I13', 'I15'],
  dlp: ['E78'],
  smoke: ['Z720', 'F17'],
  obese: ['E66'],
  fh: ['Z824'],
} as const;

/** ICD-10 prefixes for comorbidities / specific high-risk conditions. */
export const COMORBID_ICD = {
  ckd: ['N18', 'R80'],
  mets: ['E888'],
  autoimmune: ['M05', 'M06', 'M32', 'L40'],
  pregnancy: ['O244', 'O11', 'O13', 'O14', 'O15'],
} as const;

const anyIcd = (codes: readonly string[]) => codes.map((c) => `d.icd10 LIKE '${c}%'`).join(' OR ');

/**
 * Major-risk-factor and comorbidity data for every visit in the date range: diagnosis flags from the patient's whole
 * diagnosis history (any visit) plus the screening vitals of this visit. No protected personal fields.
 */
export function riskFactorsSql(dateFrom: string, dateTo: string): string {
  const range = `BETWEEN ${sqlDate(dateFrom)} AND ${sqlDate(dateTo)}`;
  const flag = (codes: readonly string[]) => `MAX(CASE WHEN ${anyIcd(codes)} THEN 1 ELSE 0 END)`;
  return `
    SELECT o.vn, s.bps, s.bpd, s.bw, s.height, s.waist
      ,dx.dm, dx.ht, dx.dlp, dx.smoke, dx.obese, dx.fh
      ,dx.ckd, dx.mets, dx.autoimmune, dx.pregnancy
      ,(CASE WHEN c.vn IS NULL THEN 0 ELSE 1 END) as cvd_screened
      ,c.risk_score as cvd_risk, c.cvd_risk_score_type_id as cvd_level, ct.cvd_risk_score_type_name as cvd_level_name
    FROM ovst o
    left outer join opdscreen s on s.vn=o.vn
    left outer join opdscreen_cvd c on c.vn=o.vn
    left outer join cvd_risk_score_type ct on ct.cvd_risk_score_type_id=c.cvd_risk_score_type_id
    left outer join (
      SELECT v2.hn
        ,${flag(RISK_ICD.dm)} as dm
        ,${flag(RISK_ICD.ht)} as ht
        ,${flag(RISK_ICD.dlp)} as dlp
        ,${flag(RISK_ICD.smoke)} as smoke
        ,${flag(RISK_ICD.obese)} as obese
        ,${flag(RISK_ICD.fh)} as fh
        ,${flag(COMORBID_ICD.ckd)} as ckd
        ,${flag(COMORBID_ICD.mets)} as mets
        ,${flag(COMORBID_ICD.autoimmune)} as autoimmune
        ,${flag(COMORBID_ICD.pregnancy)} as pregnancy
      FROM ovstdiag d
      JOIN ovst v2 ON v2.vn = d.vn
      WHERE v2.hn IN (SELECT hn FROM ovst WHERE vstdate ${range})
      GROUP BY v2.hn
    ) dx on dx.hn=o.hn
    WHERE o.vstdate ${range}`;
}

/** Every row of the same patient as this visit. */
const samePatient = (vn: string) => `o.hn = (SELECT hn FROM ovst WHERE vn = ${sqlVn(vn)})`;

/**
 * Screening vitals of the patient's visits up to this one (newest first), used to pre-fill the CV risk form:
 * a value missing today can come from an earlier visit (see pickVitals). No protected personal fields.
 */
export const vitalsHistorySql = (vn: string) => `
    SELECT o.vn, o.vstdate, s.bps, s.bpd, s.bw, s.height, s.waist, s.cholesterol, s.hdl
      ,(SELECT vstdate FROM ovst WHERE vn = ${sqlVn(vn)}) as visit_date
    FROM opdscreen s
    JOIN ovst o ON o.vn = s.vn
    WHERE ${samePatient(vn)}
      AND o.vstdate <= (SELECT vstdate FROM ovst WHERE vn = ${sqlVn(vn)})
    ORDER BY o.vstdate DESC, o.vsttime DESC
    LIMIT 30`;

/** smoking_type.nhso_code values that tick "สูบบุหรี่": 2 = still smoking / quit < 1 month, 1 = quit ≥ 1 month. */
export const SMOKING_NHSO_CODES = ['1', '2'] as const;

/** A row when this visit's screening records smoking (opdscreen.smoking_type_id). No protected personal fields. */
export const smokingSql = (vn: string) => `
    select smoking_type_id from opdscreen
    where vn=${sqlVn(vn)} and smoking_type_id in(select smoking_type_id from smoking_type where nhso_code in(${SMOKING_NHSO_CODES.map((c) => `'${c}'`).join(',')}))`;

/** Glucose-lowering drugs (matched in drugitems.name). SGLT2 inhibitors and GLP-1 agonists are left out on purpose:
 *  they are also prescribed for heart failure, CKD and obesity, so they do not by themselves mean diabetes. */
export const DM_DRUG_NAMES = [
  'metformin', 'glipizide', 'gliclazide', 'glibenclamide', 'glimepiride', 'pioglitazone', 'acarbose', 'repaglinide',
  'sitagliptin', 'vildagliptin', 'linagliptin', 'saxagliptin', 'alogliptin',
  'insulin', 'mixtard', 'actrapid', 'humulin', 'novomix', 'novorapid', 'lantus', 'levemir', 'glargine',
] as const;
/** Days before the visit in which a glucose-lowering drug counts. */
export const DM_DRUG_LOOKBACK_DAYS = 365;
export const FPG_DM_THRESHOLD = 126;

/**
 * Diabetes signals for the patient of this visit (auto-ticks "เบาหวาน"): any E10–E14 diagnosis in the history,
 * a glucose-lowering drug within DM_DRUG_LOOKBACK_DAYS before the visit, and this visit's FBS
 * (opdscreen.fbs, else lab link sys_lab_code 2). No protected personal fields.
 */
export function diabetesSql(d: Dialect, vn: string): string {
  const since = d === 'mysql' ? `DATE_SUB(o.vstdate, INTERVAL ${DM_DRUG_LOOKBACK_DAYS} DAY)` : `o.vstdate - ${DM_DRUG_LOOKBACK_DAYS}`;
  const dx = RISK_ICD.dm.map((c) => `dx.icd10 LIKE '${c}%'`).join(' OR ');
  const drug = DM_DRUG_NAMES.map((n) => `LOWER(di.name) LIKE '%${n}%'`).join(' OR ');
  return `
    SELECT
      (SELECT MAX(dx.icd10) FROM ovstdiag dx JOIN ovst v2 ON v2.vn = dx.vn WHERE v2.hn = o.hn AND (${dx})) as dm_icd10
      ,(SELECT MAX(di.name) FROM opitemrece r JOIN drugitems di ON di.icode = r.icode
         WHERE r.hn = o.hn AND r.vstdate BETWEEN ${since} AND o.vstdate AND (${drug})) as dm_drug
      ,(SELECT MAX(s.fbs) FROM opdscreen s WHERE s.vn = o.vn AND s.fbs > 0) as screen_fbs
      ,(SELECT ${agg(d, 'l.lab_order_result', ';')} FROM lab_order l
         JOIN lab_head h ON h.lab_order_number = l.lab_order_number
         JOIN sys_lab_link sl ON sl.lab_items_code = l.lab_items_code
         WHERE sl.sys_lab_code_id = '2' AND h.vn = o.vn) as lab_fbs
    FROM ovst o
    WHERE o.vn = ${sqlVn(vn)}`;
}

/** HOSxP standard lab codes (sys_lab_code), mapped to each hospital's lab items through sys_lab_link. */
export const SYS_LAB_CODE = { tc: 4, hdl: 6 } as const;

/** Total Cholesterol and HDL results ordered at this visit (lab link). No protected personal fields. */
export const labLinkSql = (vn: string) => `
    select sl.sys_lab_code_id, l.lab_order_result
    from lab_order l
    left outer join lab_head h on h.lab_order_number=l.lab_order_number
    left outer join sys_lab_link sl on sl.lab_items_code=l.lab_items_code
    where sl.sys_lab_code_id in ('${SYS_LAB_CODE.tc}','${SYS_LAB_CODE.hdl}')
    and h.vn=${sqlVn(vn)}
    order by l.lab_order_number`;

/** Every Thai CV Risk result saved for the patient of this visit (oldest first). No protected personal fields. */
export const cvdHistorySql = (vn: string) => `
    SELECT c.vn, o.vstdate, c.screen_datetime, c.risk_score, c.cvd_risk_score_type_id as level
      ,ct.cvd_risk_score_type_name as level_name, c.tc, c.is_smoking, c.is_diabetes, c.staff
    FROM opdscreen_cvd c
    JOIN ovst o ON o.vn = c.vn
    left outer join cvd_risk_score_type ct on ct.cvd_risk_score_type_id = c.cvd_risk_score_type_id
    WHERE ${samePatient(vn)}
    ORDER BY o.vstdate, c.screen_datetime`;
