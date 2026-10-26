import { connect, readConfig } from '../../server/db';
const db = await connect(readConfig()!);
const rows = await db.query(`SELECT c.vn, c.risk_score, c.pfull_score, c.cvd_risk_score_type_id, c.staff, c.screen_datetime FROM opdscreen_cvd c JOIN ovst o ON o.vn=c.vn ORDER BY c.screen_datetime DESC LIMIT 15`);
console.log(rows);
process.exit(0);
