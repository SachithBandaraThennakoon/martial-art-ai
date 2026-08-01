import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir=path.resolve("research/outputs/evaluation_actions/20260801");
await fs.mkdir(outputDir,{recursive:true});

const actions=[
 ["EA01","C01","Independent landmark and jab-form accuracy","No blinded landmark/form labels exist for P001.","Limitation + future evaluation","Not required for bounded feasibility conclusion","Disclose that operation/screenshots show function, not accuracy; propose independent frame annotation later.","No","Population or application accuracy","Open—bounded"],
 ["EA02","C02","Real jab-domain ACP evaluation and component ablation","ACP is evaluated on participant-held-out Human3.6M-17; no grouped jab ground truth or ablation.","Limitation + future evaluation","Not required for benchmark-specific prototype conclusion","Report benchmark/domain gap and avoid attributing gains to individual components; defer grouped jab evaluation/ablation.","No","Jab prediction validity or component causality","Open—bounded"],
 ["EA03","C03","Last-pose and constant-velocity baselines","Frozen ACP package reports both baselines and per-horizon errors.","Completed from existing evidence","Complete","Retain benchmark-specific normalized metrics and relative error reductions.","Yes","Millimetres, jab-domain or state-of-the-art performance","Closed"],
 ["EA04","C04","Real annotated phase and boundary evaluation","Phase metrics use generated bootstrap data; P001 has no frozen independent framewise phase labels.","Limitation + future evaluation","Not required for generated-pipeline conclusion","Label metrics as generator-defined pipeline evidence; defer grouped real annotated boundary evaluation.","No","Real-jab phase accuracy","Open—bounded"],
 ["EA05","C06","Rule-only versus hybrid end-to-end comparison","Historical export has no verified experimental-condition label.","Limitation + future evaluation","Not required for implemented-framework feasibility","Do not reconstruct conditions retrospectively; report absence and defer a condition-labelled replay.","No","Comparative coaching benefit or causal effect","Open—bounded"],
 ["EA06","C08","Independent validation of jab variables and thresholds","P001 traces support multi-joint variables, but thresholds are researcher-authored.","Limitation + future evaluation","Not required for expert-informed prototype description","Describe thresholds as expert-authored implementation choices; defer independent expert/sensor triangulation.","No","Universal or clinically validated thresholds","Open—bounded"],
 ["EA07","Cross-cutting","End-to-end latency and frame-rate measurement","Only model-only ONNX latency exists; export contains zero response-time observations.","Limitation + future evaluation","Not required for model-only latency claim","Keep ACP/phase latency labelled model-only; defer camera-to-feedback timing on the same laptop.","No","Real-time full-system performance","Open—bounded"],
 ["EA08","Cross-cutting","Structured usability ratings","No structured P001 usability instrument was captured.","Limitation + future evaluation","Not required for descriptive expert self-evaluation","Use supplied commentary only as qualitative expert observation; do not invent retrospective scores.","No","Participant usability or satisfaction score","Open—bounded"],
 ["EA09","Cross-cutting","Canonical, rule-engine and repetition-row inconsistency","practice-42 preserves 3 canonical reps, 0 rule-engine reps and one implausible-duration repetition row.","Completed as failure-mode evidence","Complete","Retain and report the discrepancy; do not repair or harmonize the historical evidence.","Yes","Perfect integration or internally consistent persistence","Closed"],
 ["EA10","Cross-cutting","Generalization beyond P001, jab and laptop camera","Available controlled evidence is intentionally limited to one researcher-expert case.","Limitation + future evaluation","Not required for n=1 expert feasibility conclusion","Freeze scope; defer additional people, techniques, viewpoints and devices.","No","Population effectiveness or cross-technique generalization","Open—bounded"],
 ["EA11","Cross-cutting","Operational LLM evaluation","Implementation audit found deterministic rule/template feedback and no operational OpenAI LLM.","Not applicable to current artifact","Complete","Evaluate and describe the deployed deterministic coaching layer; keep any LLM comparison as future work only.","Yes","Current LLM operation, intelligence or benefit","Closed—not applicable"],
 ["EA12","Cross-cutting","Private recordings in report","User requires recordings to remain private and excluded.","Protocol constraint","Complete","Use derived anonymized screenshots/data only where allowed; do not insert video into report artifacts.","Yes","Video-based report evidence","Closed—constraint"],
];

const wb=Workbook.create();
const summary=wb.worksheets.add("Action Summary");
const reg=wb.worksheets.add("Evaluation Actions");
const gate=wb.worksheets.add("Chapter Gate Checklist");
const locks=wb.worksheets.add("Evidence Locks");
for(const s of [summary,reg,gate,locks]) s.showGridLines=false;

const headers=["action_id","claim_link","evidence_gap","current_evidence","disposition","before_chapter_planning","required_handling","uses_existing_evidence_only","prohibited_claim","status"];
reg.getRangeByIndexes(0,0,actions.length+1,headers.length).values=[headers,...actions];
reg.tables.add(`A1:J${actions.length+1}`,true,"EvaluationActionTable"); reg.freezePanes.freezeRows(1); reg.freezePanes.freezeColumns(2);
reg.getRange("A1:J1").format={fill:"#123047",font:{bold:true,color:"#FFFFFF"},wrapText:true};
reg.getRange(`A2:J${actions.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:9,color:"#172B3A"}};
[11,14,38,52,26,29,54,20,42,19].forEach((w,i)=>reg.getRangeByIndexes(0,i,actions.length+1,1).format.columnWidth=w);
reg.getRange(`J2:J${actions.length+1}`).conditionalFormats.addCustom(`=LEFT(J2,6)="Closed"`,{fill:"#DDF2E3",font:{color:"#145A32",bold:true}});
reg.getRange(`J2:J${actions.length+1}`).conditionalFormats.addCustom(`=LEFT(J2,4)="Open"`,{fill:"#FFF2CC",font:{color:"#7A4E12",bold:true}});

summary.getRange("A1:H1").merge(); summary.getRange("A1").values=[["Combat Cognition — Unresolved Evaluation-Action Register"]];
summary.getRange("A2:H2").merge(); summary.getRange("A2").values=[["Decision freeze for the P001 jab-only laptop-camera feasibility case. No thesis prose."]];
summary.getRange("A4:B11").values=[["Register date",new Date(2026,7,1)],["Total actions",null],["Closed / complete",null],["Open—bounded",null],["Additional data required now",null],["New participants required now","No"],["New recordings required now","No"],["Scope expansion","None"]];
summary.getRange("B4").format.numberFormat="yyyy-mm-dd";
summary.getRange("B5").formulas=[[`=COUNTA('Evaluation Actions'!$A$2:$A$${actions.length+1})`]];
summary.getRange("B6").formulas=[[`=COUNTIF('Evaluation Actions'!$J$2:$J$${actions.length+1},"Closed")+COUNTIF('Evaluation Actions'!$J$2:$J$${actions.length+1},"Closed—not applicable")+COUNTIF('Evaluation Actions'!$J$2:$J$${actions.length+1},"Closed—constraint")`]];
summary.getRange("B7").formulas=[[`=COUNTIF('Evaluation Actions'!$J$2:$J$${actions.length+1},"Open—bounded")`]];
summary.getRange("B8").formulas=[[`=COUNTIF('Evaluation Actions'!$F$2:$F$${actions.length+1},"Required now")`]];
summary.getRange("A13:H13").values=[["Decision rule","Proceed condition","Evidence boundary","P001 treatment","Model treatment","Software treatment","Media treatment","Next protocol gate"]];
summary.getRange("A14:H14").values=[["Unobtainable evidence is disclosed, not invented","All open items have explicit limitation/future-work handling","No combined overall accuracy","Expert self-evaluation only","Benchmark/generated/model-only metrics remain labelled","Tests establish verification, not task accuracy","Screenshots restricted; videos excluded","Finalize figures, tables and appendices"]];
summary.getRange("A1:H1").format={fill:"#123047",font:{bold:true,color:"#FFFFFF",size:16}};
summary.getRange("A2:H2").format={fill:"#DCEAF2",font:{italic:true,color:"#35566B"}};
summary.getRange("A4:A11").format={fill:"#EAF2F6",font:{bold:true,color:"#123047"}};
summary.getRange("A13:H13").format={fill:"#2D6A78",font:{bold:true,color:"#FFFFFF"},wrapText:true};
summary.getRange("A14:H14").format={fill:"#F4F8FA",font:{color:"#172B3A"},wrapText:true,verticalAlignment:"top"};
summary.getRange("A1:H14").format.borders={preset:"outside",style:"thin",color:"#9FB8C5"};
summary.getRange("A1:H14").format.columnWidth=24; summary.getRange("B4:B11").format.columnWidth=44;
summary.getRange("1:1").format.rowHeight=31; summary.getRange("2:2").format.rowHeight=24; summary.getRange("13:13").format.rowHeight=34; summary.getRange("14:14").format.rowHeight=80;

const gateRows=[
 ["G01","Claim reconciliation frozen","Complete","Four supported-with-boundary; five partially supported; no unsupported claims"],
 ["G02","Baseline requirement checked","Complete","Last-pose and constant-velocity evidence already frozen in ACP package"],
 ["G03","Missing empirical evidence dispositioned","Complete","EA01, EA02, EA04–EA08 and EA10 become explicit limitations/future evaluation"],
 ["G04","Integration discrepancy retained","Complete","EA09 preserved as failure-mode evidence"],
 ["G05","Operational reasoning identity controlled","Complete","EA11 confirms deterministic rule/template artifact; LLM evaluation not applicable"],
 ["G06","Participant/technique/camera scope frozen","Complete","P001 only; jab only; laptop camera"],
 ["G07","Media handling frozen","Complete","Screenshots restricted; videos private and excluded"],
 ["G08","Figures/tables/appendices finalized","Next","Preparation step 3"],
 ["G09","University-format chapter plan and claim approval","Pending","Preparation step 4; thesis writing still prohibited"],
];
gate.getRangeByIndexes(0,0,gateRows.length+1,4).values=[["gate_id","gate","status","evidence_or_next_action"],...gateRows];
gate.tables.add(`A1:D${gateRows.length+1}`,true,"ChapterGateTable");
gate.getRange("A1:D1").format={fill:"#244F62",font:{bold:true,color:"#FFFFFF"},wrapText:true};
gate.getRange(`A2:D${gateRows.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:10,color:"#172B3A"}};
[12,42,15,72].forEach((w,i)=>gate.getRangeByIndexes(0,i,gateRows.length+1,1).format.columnWidth=w);

const lockRows=[
 ["L01","Authoritative participant","P001 researcher/developer/martial-arts expert","Do not relabel as independent participant"],
 ["L02","Technique/device","Jab only; laptop camera","Do not generalize to other techniques/devices"],
 ["L03","Confirmed case","practice-42; 3 clusters; 250 frames; 8.3 s; 96% tracking; 22 decoder changes","Self-validation, not ground truth"],
 ["L04","Database","Full history retained but historical/outlier records excluded from headline case","Do not compute aggregate accuracy"],
 ["L05","ACP","Human3.6M-17 benchmark with simple baselines and normalized metrics","Not live jab or physical-unit evidence"],
 ["L06","Phase","Generated bootstrap metrics","Not real-jab phase accuracy"],
 ["L07","Latency","ONNX model-only","Not camera-to-feedback latency"],
 ["L08","Feedback","Deterministic rule/template","No operational OpenAI LLM"],
 ["L09","Media","Screenshots restricted; recordings private and excluded","Do not insert videos"],
];
locks.getRangeByIndexes(0,0,lockRows.length+1,4).values=[["lock_id","evidence_area","frozen_interpretation","prohibition"],...lockRows];
locks.tables.add(`A1:D${lockRows.length+1}`,true,"EvidenceLockTable");
locks.getRange("A1:D1").format={fill:"#7A4E12",font:{bold:true,color:"#FFFFFF"},wrapText:true};
locks.getRange(`A2:D${lockRows.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:10,color:"#172B3A"}};
[12,25,70,55].forEach((w,i)=>locks.getRangeByIndexes(0,i,lockRows.length+1,1).format.columnWidth=w);

const scan=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"});
await fs.writeFile(path.join(outputDir,"formula_scan.ndjson"),scan.ndjson,"utf8");
for(const [sheetName,range,fileName] of [["Action Summary","A1:H14","action_summary.png"],["Evaluation Actions",`A1:J${actions.length+1}`,"evaluation_actions.png"],["Chapter Gate Checklist",`A1:D${gateRows.length+1}`,"chapter_gate_checklist.png"],["Evidence Locks",`A1:D${lockRows.length+1}`,"evidence_locks.png"]]){
 const preview=await wb.render({sheetName,range,scale:1.1,format:"png"});
 await fs.writeFile(path.join(outputDir,fileName),new Uint8Array(await preview.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(path.join(outputDir,"Combat_Cognition_Evaluation_Action_Register.xlsx"));
const checks=[];
for(const [sheetName,range] of [["Action Summary","A1:H14"],["Evaluation Actions",`A1:J${actions.length+1}`],["Chapter Gate Checklist",`A1:D${gateRows.length+1}`],["Evidence Locks",`A1:D${lockRows.length+1}`]]) checks.push((await wb.inspect({kind:"table",range:`${sheetName}!${range}`,include:"values,formulas",tableMaxRows:20,tableMaxCols:12})).ndjson);
await fs.writeFile(path.join(outputDir,"verification.ndjson"),checks.join("\n"),"utf8");
console.log("Exported evaluation-action register");
