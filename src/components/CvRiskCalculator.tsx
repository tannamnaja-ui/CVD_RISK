import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ENGINES,
  MODELS,
  THAI_ENGINE_MODE,
  isThaiEngine,
  MODEL_ORDER,
  assess,
  modelFor,
  type Assessment,
  type EngineId,
  type ModelResult,
  type NumericField,
  type QriskConditions,
  type ThaiMode,
} from '../lib/engines';
import { QRISK_ETHNICITIES } from '../lib/engines/qrisk3';
import { THAI_FORMULAS } from '../lib/engines/thai';
import { SCORE2_REGION_LABELS } from '../lib/engines/score2';
import { WHO_REGION_LABELS } from '../lib/engines/whoIsh';
import { EMPTY_FORM, NUMERIC_RULES, resolveThaiMode, parseNumber, toPatient, validateForModel, visibleFields, type FormValues } from '../lib/formModel';
import { useCvdSave } from '../hooks/useCvdSave';
import { useHiddenEngines } from '../hooks/useHiddenEngines';
import { CompareTable } from './CompareTable';
import { EngineSelector } from './EngineSelector';
import { EngineVisibilityDialog } from './EngineVisibilityDialog';
import { FormulaDialog } from './FormulaDialog';
import { CheckChip, ChipInfoButton, NumberField, Panel, SegmentedControl, SelectField } from './FormControls';
import { AlertTriangleIcon, CalculatorIcon, CheckIcon, EyeOffIcon, InfoIcon, SaveIcon, FunctionIcon, PrinterIcon, ResetIcon, SettingsIcon, StethoscopeIcon, UserIcon } from './Icons';
import { PatientSummary, type SummaryPatient } from './PatientSummary';
import { Modal } from './Modal';
import { DM_DRUG_LOOKBACK_DAYS, DM_DRUG_NAMES, FPG_DM_THRESHOLD, RISK_ICD, diabetesSql, smokingSql } from '../lib/hosxp/sql';
import { thaiResult } from '../lib/whatIf';

/** Thai CV Risk picks its model from the data: TC entered → Laboratory, otherwise Non-Laboratory (WHtR). */
const withAutoThaiMode = (v: FormValues): FormValues => ({ ...v, thaiMode: resolveThaiMode(v) });

/** Delay before auto-calculating, so a half-typed number (e.g. SBP "12") is not evaluated. */
const AUTO_CALC_DELAY_MS = 400;
import { AssessmentPanel } from './AssessmentPanel';

/** Shown with the HOSxP code (patient.sex: 1 = male, 2 = female). */
const GENDER_LABEL = { male: 'ชาย = 1', female: 'หญิง = 2' } as const;

const GENDER_OPTIONS = [
  { value: 'male' as const, label: GENDER_LABEL.male },
  { value: 'female' as const, label: GENDER_LABEL.female },
];

const CONDITION_LABELS: { key: keyof QriskConditions; label: string; maleOnly?: boolean }[] = [
  { key: 'familyHistory', label: 'ญาติสายตรงเป็น Angina/MI อายุ < 60 ปี' },
  { key: 'ckd', label: 'โรคไตเรื้อรัง (CKD stage 3–5)' },
  { key: 'ra', label: 'โรคข้ออักเสบรูมาตอยด์ (RA)' },
  { key: 'af', label: 'หัวใจเต้นผิดจังหวะ (AF)' },
  { key: 'migraine', label: 'ไมเกรน' },
  { key: 'sle', label: 'โรคพุ่มพวง (SLE)' },
  { key: 'steroids', label: 'ใช้ยาสเตียรอยด์ชนิดรับประทานประจำ' },
  { key: 'atypicalAntipsychotic', label: 'ใช้ยารักษาโรคจิตกลุ่ม Atypical' },
  { key: 'severeMentalIllness', label: 'โรคทางจิตเวชรุนแรง' },
  { key: 'erectileDysfunction', label: 'ภาวะหย่อนสมรรถภาพทางเพศ', maleOnly: true },
];

const FIELD_PLACEHOLDERS: Partial<Record<NumericField, string>> = {
  age: 'เช่น 55',
  sbp: 'เช่น 120',
  tc: 'เช่น 200',
  hdl: 'เช่น 50',
  waist: 'เช่น 80',
  height: 'เช่น 165',
  weight: 'เช่น 65',
  sbpSd: 'เช่น 8',
  townsend: '0',
};

interface CvRiskCalculatorProps {
  initialValues?: Partial<FormValues>;
  vn?: string;
  /** printed on the patient summary sheet */
  patient?: SummaryPatient;
  /** after the result was saved to opdscreen_cvd */
  onSaved?: () => void;
}

export function CvRiskCalculator({ initialValues, vn, patient, onSaved }: CvRiskCalculatorProps) {
  const [hidden, setHidden] = useHiddenEngines();
  const [engine, setEngine] = useState<EngineId>(() => ENGINES.find((e) => !hidden.includes(e.id))!.id);
  const [rawValues, setValues] = useState<FormValues>(() => ({ ...EMPTY_FORM, ...initialValues }));
  /** sex recorded in HOSxP for this patient — fixed, not editable */
  const sexFromHosxp = initialValues?.gender || null;
  // the selected card pins a Thai formula (thai-ratio / thai-tc / thai-nonlab); otherwise automatic
  const values = useMemo(() => withAutoThaiMode({ ...rawValues, thaiFormula: THAI_ENGINE_MODE[engine] ?? 'auto' }), [rawValues, engine]);
  const cvdSave = useCvdSave(vn, values);
  const [touched, setTouched] = useState<Partial<Record<NumericField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<ModelResult | null>(null);
  const [comparison, setComparison] = useState<Assessment[] | null>(null);
  const [stale, setStale] = useState(false);
  const [formulaEngine, setFormulaEngine] = useState<EngineId | null>(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [smokingInfoOpen, setSmokingInfoOpen] = useState(false);
  const [dmInfoOpen, setDmInfoOpen] = useState(false);
  /** VN shown in the SQL of the condition dialogs */
  const sqlVnText = vn && /^[0-9A-Za-z-]{1,20}$/.test(vn) ? vn : '0';
  const tidySql = (sql: string) => sql.trim().replace(/\n\s+/g, '\n');
  /** the summary sheet is about Thai CV Risk — the score that is saved — so it needs that score's data */
  const canSummarize = useMemo(() => thaiResult(values) !== null, [values]);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    if (cvdSave.status.state === 'saved' && cvdSave.status.justNow) onSavedRef.current?.();
  }, [cvdSave.status]);
  const resultRef = useRef<HTMLElement>(null);
  const compareRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const model = modelFor(engine, values.thaiMode);
  const errors = useMemo(() => validateForModel(values, model), [values, model]);
  const shown = useMemo(() => visibleFields(model, values), [model, values]);
  const options = new Set(model.options ?? []);
  const isQrisk = options.has('qrisk');
  const showError = (f: NumericField) => (submitted || touched[f] ? errors[f] : undefined);


  function compute(nextValues: FormValues, nextEngine: EngineId, hiddenEngines = hidden) {
    const m = modelFor(nextEngine, nextValues.thaiMode);
    const patient = toPatient(nextValues);
    const outcome = assess(m, patient);
    return {
      ok: Object.keys(validateForModel(nextValues, m)).length === 0 && outcome.status === 'ok',
      result: outcome.status === 'ok' ? outcome.result : null,
      comparison: MODEL_ORDER.filter((id) => !hiddenEngines.includes(MODELS[id].engine)).map((id) => assess(MODELS[id], patient)),
    };
  }

  /** Hiding the active engine moves the selection to the first engine still shown. */
  function handleHiddenChange(next: EngineId[]) {
    setHidden(next);
    const nextEngine = next.includes(engine) ? ENGINES.find((e) => !next.includes(e.id))!.id : engine;
    if (nextEngine !== engine) {
      switchTo(nextEngine, values, next);
    } else if (comparison) {
      setComparison(compute(values, engine, next).comparison);
    }
  }

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
    if (result) setStale(true);
  }

  const updateCondition = (key: keyof QriskConditions, checked: boolean) => update('conditions', { ...values.conditions, [key]: checked });

  /** Switching engine/mode re-runs the calculation when there is already a result and the data suffices. */
  function switchTo(nextEngine: EngineId, nextValues: FormValues, hiddenEngines = hidden) {
    setEngine(nextEngine);
    setValues(nextValues);
    if (!result) return;
    const r = compute(nextValues, nextEngine, hiddenEngines);
    setResult(r.ok ? r.result : null);
    if (comparison) setComparison(r.comparison);
    setStale(false);
  }

  // Auto-calculate once every field the selected model needs is valid; the button still works too.
  useEffect(() => {
    if (Object.keys(errors).length > 0) return;
    const timer = setTimeout(() => {
      const r = compute(values, engine);
      if (!r.result) return;
      setResult(r.result);
      setComparison((c) => (c ? r.comparison : c));
      setStale(false);
    }, AUTO_CALC_DELAY_MS);
    return () => clearTimeout(timer);
    // compute only reads values/engine/hidden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, engine, errors, hidden]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const r = compute(values, engine);
    setResult(r.result);
    if (comparison) setComparison(r.comparison);
    setStale(false);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  function handleReset() {
    // the HOSxP sex is fixed, so it survives a reset
    setValues({ ...EMPTY_FORM, gender: sexFromHosxp ?? '' });
    setTouched({});
    setSubmitted(false);
    setResult(null);
    setComparison(null);
    setStale(false);
  }

  function toggleCompare() {
    if (comparison) {
      setComparison(null);
      return;
    }
    setComparison(compute(values, engine).comparison);
    setStale(false);
    requestAnimationFrame(() => compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const numberField = (f: NumericField, label: string, extra: { hint?: string; step?: number } = {}) => {
    const rule = NUMERIC_RULES[f];
    const optional = model.optional?.includes(f);
    return (
      <NumberField
        key={f}
        label={label}
        unit={rule.unit}
        value={values[f]}
        onChange={(v) => update(f, v)}
        onBlur={() => setTouched((t) => ({ ...t, [f]: true }))}
        error={showError(f)}
        placeholder={FIELD_PLACEHOLDERS[f]}
        min={rule.min}
        max={rule.max}
        optional={optional}
        {...extra}
      />
    );
  };

  const whtr = useMemo(() => {
    const w = parseNumber(values.waist);
    const h = parseNumber(values.height);
    return w && h ? w / h : null;
  }, [values.waist, values.height]);

  const bmi = useMemo(() => {
    const w = parseNumber(values.weight);
    const h = parseNumber(values.height);
    return w && h ? w / (h / 100) ** 2 : null;
  }, [values.weight, values.height]);

  const hasSettings = options.has('score2Region') || options.has('whoRegion') || options.has('ascvdRace') || isQrisk;
  const ageRangeText = model.ageRange[1] >= 100 ? `${model.ageRange[0]} ปีขึ้นไป` : `${model.ageRange[0]}–${model.ageRange[1]} ปี`;

  return (
    <div className="calculator">
      <form ref={formRef} className="screen" onSubmit={handleSubmit} noValidate>
        <Panel
          icon={<FunctionIcon size={18} />}
          title="สูตรประเมิน"
          en="Risk Engine"
          tone="primary"
          actions={
            <>
              <button type="button" className="btn btn--chip" onClick={() => setFormulaEngine(engine)}>
                <FunctionIcon size={16} /> สูตรที่ใช้คำนวณ
              </button>
              <button type="button" className="btn btn--chip" onClick={() => setVisibilityOpen(true)}>
                <EyeOffIcon size={16} /> ซ่อนสูตรที่ไม่ใช้
                {hidden.length > 0 && <span className="btn__count">{hidden.length}</span>}
              </button>
            </>
          }
        >
          <EngineSelector value={engine} hidden={hidden} onChange={(e) => switchTo(e, values)} onShowFormula={setFormulaEngine} />
          {isThaiEngine(engine) && <ThaiFormulaInfoBox auto={values.thaiFormula === 'auto'} used={values.thaiMode} />}
          <p className="panel__note">
            <strong>{model.name}</strong> · {model.outcome} · อายุ {ageRangeText}
          </p>
        </Panel>

        <div className="panel-row">
          <Panel icon={<UserIcon size={18} />} title="ข้อมูลผู้ป่วย" en="Patient Data" tone="blue">
            <div className="fields">
              {numberField('age', 'อายุ (Age)', { hint: `สูตรนี้รองรับ ${ageRangeText}` })}
              <div className="field">
                <span className="field__label">เพศ (Sex)</span>
                {sexFromHosxp ? (
                  // sex recorded in HOSxP: show it as a fixed value, not a choice
                  <div className="field__readonly" aria-label={`เพศ ${GENDER_LABEL[sexFromHosxp]}`}>
                    {GENDER_LABEL[sexFromHosxp]}
                    <small>จาก HOSxP</small>
                  </div>
                ) : (
                  <SegmentedControl
                    options={GENDER_OPTIONS}
                    value={values.gender}
                    onChange={(g) => update('gender', g)}
                    ariaLabel="เพศ"
                    invalid={!!(submitted && errors.gender)}
                  />
                )}
                {submitted && errors.gender && (
                  <p className="field__error" role="alert">
                    {errors.gender}
                  </p>
                )}
              </div>
              {numberField('sbp', 'ความดันโลหิต SBP')}
            </div>
          </Panel>

          <Panel icon={<AlertTriangleIcon size={18} />} title="ปัจจัยเสี่ยง" en="Risk Factors" tone="amber">
            <div className="checks">
              <CheckChip
                label="สูบบุหรี่ (Smoking)"
                hint="สูบประจำ หรือเลิกสูบไม่เกิน 1 ปี"
                checked={values.smoke}
                onChange={(c) => update('smoke', c)}
                hintAction={
                  <ChipInfoButton onClick={() => setSmokingInfoOpen(true)} title="ดูเงื่อนไขการติ๊กสูบบุหรี่อัตโนมัติ">
                    <InfoIcon size={14} /> เงื่อนไข
                  </ChipInfoButton>
                }
              />
              <CheckChip
                label="เป็นโรคเบาหวาน (Diabetes Mellitus)"
                hint="FPG ≥ 126 mg/dL หรือได้รับยารักษาเบาหวาน"
                checked={values.dm}
                onChange={(c) => update('dm', c)}
                hintAction={
                  <ChipInfoButton onClick={() => setDmInfoOpen(true)} title="ดูเงื่อนไขการติ๊กเบาหวานอัตโนมัติ">
                    <InfoIcon size={14} /> เงื่อนไข
                  </ChipInfoButton>
                }
              />
              {options.has('bpMeds') && (
                <CheckChip
                  label="รับประทานยาลดความดัน (Treated HT)"
                  hint="กำลังรักษาความดันโลหิตสูงด้วยยา"
                  checked={values.bpMeds}
                  onChange={(c) => update('bpMeds', c)}
                />
              )}
              {isQrisk && !values.smoke && (
                <CheckChip label="เคยสูบบุหรี่ แต่เลิกแล้ว (Ex-smoker)" hint="ใช้ใน QRISK3" checked={values.exSmoker} onChange={(c) => update('exSmoker', c)} />
              )}
            </div>

            {isQrisk && (values.dm || values.smoke) && (
              <div className="fields fields--spaced">
                {values.dm && (
                  <SelectField
                    label="ชนิดเบาหวาน (QRISK3)"
                    value={values.dmType}
                    options={[
                      { value: 'type2', label: 'เบาหวานชนิดที่ 2' },
                      { value: 'type1', label: 'เบาหวานชนิดที่ 1' },
                    ]}
                    onChange={(v) => update('dmType', v)}
                  />
                )}
                {values.smoke && (
                  <SelectField
                    label="ปริมาณการสูบ (QRISK3)"
                    value={values.smokeIntensity}
                    options={[
                      { value: 'light', label: 'น้อย (< 10 มวน/วัน)' },
                      { value: 'moderate', label: 'ปานกลาง (10–19 มวน/วัน)' },
                      { value: 'heavy', label: 'มาก (≥ 20 มวน/วัน)' },
                    ]}
                    onChange={(v) => update('smokeIntensity', v)}
                  />
                )}
              </div>
            )}

            {isQrisk && (
              <>
                <h3 className="panel__sub">ปัจจัยเสี่ยงเพิ่มเติม (QRISK3)</h3>
                <div className="chips">
                  {CONDITION_LABELS.filter((c) => !c.maleOnly || values.gender !== 'female').map((c) => (
                    <CheckChip key={c.key} label={c.label} checked={values.conditions[c.key]} onChange={(v) => updateCondition(c.key, v)} />
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>

        <Panel icon={<StethoscopeIcon size={18} />} title="ข้อมูลทางคลินิก" en="Clinical Measurements" tone="teal">
          <div className="fields">
            {numberField('tc', 'Total Cholesterol')}
            {numberField('hdl', 'HDL Cholesterol')}
            {numberField('waist', 'รอบเอว (Waist)', { hint: 'วัดผ่านสะดือ', step: 0.1 })}
            {numberField('height', 'ส่วนสูง (Height)', { step: 0.1 })}
            <Metric
              label="อัตราส่วนรอบเอวต่อส่วนสูง (WHtR)"
              value={whtr}
              digits={2}
              warn={whtr !== null && whtr >= 0.5}
              hint={whtr === null ? 'กรอกรอบเอวและส่วนสูงเพื่อคำนวณอัตโนมัติ' : whtr >= 0.5 ? 'เกินเกณฑ์ (ควร < 0.5)' : 'อยู่ในเกณฑ์ (< 0.5)'}
            />
            {shown.has('weight') && numberField('weight', 'น้ำหนัก (Weight)', { step: 0.1 })}
            {shown.has('sbpSd') && numberField('sbpSd', 'SD ของ SBP', { hint: 'จากการวัด ≥ 2 ครั้งล่าสุด' })}
            {shown.has('townsend') && numberField('townsend', 'Townsend score', { hint: 'ค่าเริ่มต้น 0 (UK)', step: 0.1 })}
          </div>
          {shown.has('weight') && (
            <div className="metrics-row">
              <Metric
                label="ดัชนีมวลกาย (BMI)"
                value={bmi}
                digits={1}
                warn={bmi !== null && bmi >= 25}
                hint={bmi === null ? 'กรอกน้ำหนักและส่วนสูงเพื่อคำนวณอัตโนมัติ' : bmi >= 25 ? 'อ้วน (เกณฑ์เอเชีย ≥ 25)' : bmi >= 23 ? 'น้ำหนักเกิน (23–24.9)' : 'ปกติหรือต่ำกว่าเกณฑ์'}
              />
            </div>
          )}
          {engine === 'thai' && (
            <p className="panel__note">หมายเหตุ: ถ้าไม่มีค่า Cholesterol ระบบจะใช้สูตรคำนวณจากอัตราส่วน Waist/Height</p>
          )}
          {engine === 'who' && <p className="panel__note">หมายเหตุ: ถ้าไม่มีค่า Cholesterol ระบบจะใช้ตาราง WHO/ISH แบบไม่ใช้ Cholesterol</p>}
        </Panel>

        {hasSettings && (
          <Panel icon={<SettingsIcon size={18} />} title="ตั้งค่าสูตร" en="Model Settings" tone="slate">
            <div className="fields">
              {options.has('score2Region') && (
                <SelectField
                  label="ภูมิภาคความเสี่ยง (ESC Risk Region)"
                  value={values.score2Region}
                  options={Object.entries(SCORE2_REGION_LABELS).map(([value, label]) => ({ value: value as FormValues['score2Region'], label }))}
                  onChange={(v) => update('score2Region', v)}
                  hint="ประเทศไทยไม่อยู่ในกลุ่มประเทศของ ESC — เลือกตามบริบท"
                />
              )}
              {options.has('whoRegion') && (
                <SelectField
                  label="ภูมิภาค WHO"
                  value={values.whoRegion}
                  options={Object.entries(WHO_REGION_LABELS).map(([value, label]) => ({ value: value as FormValues['whoRegion'], label }))}
                  onChange={(v) => update('whoRegion', v)}
                />
              )}
              {options.has('ascvdRace') && (
                <SelectField
                  label="กลุ่มเชื้อชาติ (PCE)"
                  value={values.ascvdRace}
                  options={[
                    { value: 'white', label: 'White / Other (รวมชาวเอเชีย)' },
                    { value: 'africanAmerican', label: 'African American' },
                  ]}
                  onChange={(v) => update('ascvdRace', v)}
                />
              )}
              {isQrisk && (
                <SelectField
                  label="กลุ่มชาติพันธุ์ (QRISK3)"
                  value={values.qriskEthnicity}
                  options={QRISK_ETHNICITIES.map((label, i) => ({ value: i, label }))}
                  onChange={(v) => update('qriskEthnicity', v)}
                />
              )}
            </div>
          </Panel>
        )}

        <AssessmentPanel
          ref={resultRef}
          model={model}
          age={parseNumber(values.age)}
          result={result}
          stale={stale}
          compareOpen={comparison !== null}
          onToggleCompare={toggleCompare}
          onShowFormula={() => setFormulaEngine(engine)}
        />

        {result && comparison && <CompareTable ref={compareRef} rows={comparison} currentModel={model.id} stale={stale} />}

        <div className="action-bar">
          <button type="button" className="btn btn--ghost" onClick={handleReset}>
            <ResetIcon size={18} /> ล้างข้อมูล
          </button>
          <span className="action-bar__model">{model.shortName} · คำนวณอัตโนมัติเมื่อกรอกข้อมูลครบ</span>
          <button type="submit" className="btn btn--primary">
            <CalculatorIcon size={20} /> คำนวณความเสี่ยง
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setSummaryOpen(true)}
            disabled={!canSummarize}
            title={canSummarize ? 'ผล Thai CV Risk ปัจจัยเสี่ยงที่ปรับได้ และคำแนะนำ สำหรับให้ผู้ป่วย' : 'ข้อมูลสำหรับ Thai CV Risk ยังไม่ครบ'}
          >
            <PrinterIcon size={18} /> ใบสรุปผล
          </button>
          <button
            type="button"
            className="btn btn--save"
            onClick={cvdSave.save}
            disabled={!!cvdSave.blocked || cvdSave.status.state === 'saving'}
            title={cvdSave.blocked ?? 'บันทึกผล Thai CV Risk ลงตาราง opdscreen_cvd ของ visit นี้'}
          >
            <SaveIcon size={20} /> {cvdSave.status.state === 'saving' ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          {cvdSave.status.state === 'saved' && (
            <span className={`save-status${cvdSave.status.justNow ? ' is-fresh' : ''}`}>
              <CheckIcon size={14} /> {cvdSave.status.justNow ? 'บันทึกแล้ว' : 'บันทึกไว้แล้ว'} {formatSavedAt(cvdSave.status.row.screen_datetime)}
              {cvdSave.status.row.cvd_risk_score_type_name ? ` · ${cvdSave.status.row.cvd_risk_score_type_name}` : ''}
              {cvdSave.status.row.staff ? ` · โดย ${cvdSave.status.row.staff}` : ''}
            </span>
          )}
          {cvdSave.status.state === 'error' && (
            <span className="save-status is-error" role="alert">
              บันทึกไม่สำเร็จ: {cvdSave.status.message}
            </span>
          )}
        </div>
      </form>

      <FormulaDialog engine={formulaEngine} onSelect={setFormulaEngine} onClose={() => setFormulaEngine(null)} />
      <Modal open={smokingInfoOpen} onClose={() => setSmokingInfoOpen(false)} title="เงื่อนไข: สูบบุหรี่ (Smoking)" subtitle="ติ๊กให้อัตโนมัติจากการซักประวัติของ visit นี้">
        <div className="criteria">
          <p>
            เมื่อเปิดหน้าประเมินจากรายชื่อผู้ป่วย ระบบตรวจประเภทการสูบบุหรี่ที่บันทึกในการซักประวัติ (<code>opdscreen.smoking_type_id</code>) ของ VN ที่เลือก
            ถ้าเป็นประเภทที่มีรหัส สปสช. (<code>smoking_type.nhso_code</code>) เป็น 1 หรือ 2 จะติ๊ก "สูบบุหรี่" ให้อัตโนมัติ — แก้ไขได้ก่อนบันทึก
          </p>
          <div className="criteria__table-wrap">
            <table className="criteria__table">
              <thead>
                <tr>
                  <th>nhso_code</th>
                  <th>ความหมาย (smoking_type)</th>
                  <th>ติ๊กสูบบุหรี่</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">2</th>
                  <td>ยังสูบอยู่ หรือเลิกสูบได้ยังไม่ถึง 1 เดือน</td>
                  <td>✔</td>
                </tr>
                <tr>
                  <th scope="row">1</th>
                  <td>เลิกสูบแล้วอย่างน้อย 1 เดือน</td>
                  <td>✔</td>
                </tr>
                <tr>
                  <th scope="row">0, N</th>
                  <td>ไม่เคยสูบ, ไม่ได้ซัก</td>
                  <td>–</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <strong>คำสั่งที่ใช้</strong>
            <pre className="criteria__sql">{tidySql(smokingSql(sqlVnText))}</pre>
          </div>
        </div>
      </Modal>
      <Modal open={dmInfoOpen} onClose={() => setDmInfoOpen(false)} title="เงื่อนไข: เป็นโรคเบาหวาน (Diabetes Mellitus)" subtitle="ติ๊กให้อัตโนมัติเมื่อเข้าข้อใดข้อหนึ่ง — แก้ไขได้ก่อนบันทึก" size="lg">
        <div className="criteria">
          <div className="criteria__table-wrap">
            <table className="criteria__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>เงื่อนไข</th>
                  <th>ข้อมูลใน HOSxP</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">1</th>
                  <td>เคยได้รับการวินิจฉัยเบาหวาน ICD-10 {RISK_ICD.dm.join(', ')} ใน visit ใดก็ได้</td>
                  <td>
                    <code>ovstdiag.icd10</code> ทุก visit ของผู้ป่วย (เกณฑ์เดียวกับคอลัมน์ปัจจัยเสี่ยงในหน้ารายการผู้ป่วย)
                  </td>
                </tr>
                <tr>
                  <th scope="row">2</th>
                  <td>ได้รับยาลดน้ำตาลภายใน {DM_DRUG_LOOKBACK_DAYS} วันก่อนวันที่มา</td>
                  <td>
                    <code>opitemrece</code> + <code>drugitems.name</code> มีคำว่า: {DM_DRUG_NAMES.join(', ')}
                    <br />
                    <small>ไม่นับกลุ่ม SGLT2 (dapagliflozin, empagliflozin) และ GLP-1 เพราะใช้รักษาหัวใจล้มเหลว โรคไต และโรคอ้วนด้วย</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">3</th>
                  <td>FBS ของ visit นี้ ≥ {FPG_DM_THRESHOLD} mg/dL</td>
                  <td>
                    <code>opdscreen.fbs</code> ก่อน ถ้าไม่มีใช้ผลแล็บ <code>sys_lab_code_id = '2'</code> (FBS)
                    <br />
                    <small>FBS สูงครั้งเดียวยังไม่ใช่การวินิจฉัย — ตรวจสอบว่าอดอาหารจริง (ไม่ใช่ DTX หลังอาหาร)</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <strong>คำสั่งที่ใช้ (PostgreSQL)</strong>
            <pre className="criteria__sql">{tidySql(diabetesSql('postgresql', sqlVnText))}</pre>
          </div>
        </div>
      </Modal>
      <PatientSummary open={summaryOpen} onClose={() => setSummaryOpen(false)} values={values} patient={patient} />
      <EngineVisibilityDialog open={visibilityOpen} hidden={hidden} onChange={handleHiddenChange} onClose={() => setVisibilityOpen(false)} />
    </div>
  );
}

/** '2026-10-25 10:31:05' → '25/10/2026 10:31' */
function formatSavedAt(v: string | null): string {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
}

/** Which Thai CV Risk formula is in use and where it comes from. */
function ThaiFormulaInfoBox({ auto, used }: { auto: boolean; used: ThaiMode }) {
  const info = THAI_FORMULAS[used];
  return (
    <div className={`thai-formula thai-formula--${used}`}>
      <div className="thai-formula__info">
        <strong>
          {auto ? 'เลือกอัตโนมัติตามผลเลือด — ใช้อยู่: ' : 'ใช้: '}
          {info.name}
        </strong>{' '}
        · {info.needs}
        <p>
          <b>ที่มา:</b> {info.source}
        </p>
        {info.caution && (
          <p className="thai-formula__caution">
            <b>{info.verified ? 'หมายเหตุ' : 'ยังไม่ได้ยืนยัน'}:</b> {info.caution}
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, digits, warn, hint }: { label: string; value: number | null; digits: number; warn: boolean; hint: string }) {
  return (
    <div className={`metric${warn ? ' is-over' : ''}`}>
      <div>
        <span className="metric__label">{label}</span>
        <span className="metric__hint">{hint}</span>
      </div>
      <span className="metric__value">{value === null ? '–' : value.toFixed(digits)}</span>
    </div>
  );
}
