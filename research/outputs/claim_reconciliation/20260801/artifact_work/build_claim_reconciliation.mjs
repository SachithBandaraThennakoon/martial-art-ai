import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("research/outputs/claim_reconciliation/20260801");
await fs.mkdir(outputDir, { recursive: true });

const claims = [
  ["C01","Laptop-camera landmark perception is technically feasible","S01; S02; S03; S04","LE01; LE02; LE08","Partially supported","Implemented functional feasibility is evidenced for the P001 jab case using a laptop camera.","The application has validated landmark, jab-form, or coaching accuracy.","EA01","Pending","Local software tests and screenshots show operation; no independent landmark/form accuracy study."],
  ["C02","Skeleton sequences can be represented with spatial-temporal graphs","S05; S06; S07; S10","LE03; LE04","Partially supported","ACP-STGAT implements a spatial-temporal skeletal prediction pipeline and has offline pipeline evidence.","External action-recognition results validate ACP-STGAT for real jab prediction.","EA02","Pending","Architecture and generated/benchmark-derived checks exist; grouped real jab prediction and ablations do not."],
  ["C03","Future-pose evaluation needs simple baselines and horizon-specific errors","S08; S09","LE03","Supported with boundary","ACP results report normalized MPJPE/ADE/FDE, per-horizon evidence, and last-pose and constant-velocity baselines in normalized coordinates.","The reported errors are millimetres, jab-domain performance, or state-of-the-art superiority.","Resolved","Ready with boundary","The frozen ACP package reports 18.6% lower mean error than last pose and 21.6% lower mean error than constant velocity; the result remains benchmark-specific."],
  ["C04","Ordered movement requires temporal and segment evaluation beyond frame accuracy","S11; S12","LE04; LE06","Partially supported","The generated-data phase pipeline reports accuracy, balanced accuracy, macro/per-class F1 and a confusion matrix; post-session decoding changed 22 P001 frames.","These values establish real-jab phase accuracy or boundary performance.","EA04","Pending","Generator-defined structure is verified; real annotated phase/boundary evaluation is absent."],
  ["C05","Monocular 3D evidence is uncertain and domain-dependent","S13; S14; S15; S16","LE01; LE06; LE08","Supported with boundary","The laptop-camera case must treat pose depth, angles, visibility and occlusion as uncertain, domain-dependent evidence.","Camera coordinates are calibrated 3D biomechanics or universal physical measurements.","None","Ready with boundary","The claim is a limitation supported by literature and the declared capture configuration; it does not assert system accuracy."],
  ["C06","Situation awareness is a conceptual lens for perception, comprehension and projection","S17","LE02; LE05","Partially supported","The implementation operationalizes bounded computational perception, state interpretation and projection functions across L1-L4 and a context packet.","The software possesses human awareness, complete cognition, or biological reasoning.","EA05","Pending","Component paths are verified; comparative end-to-end decision benefit is not tested."],
  ["C07","Artifact evaluation fits an expert-informed design-science case","S18","LE02; LE03; LE04; LE06; LE07","Supported with boundary","The artifact can be evaluated as a single-participant expert feasibility and self-evaluation case using software, model, case and failure-mode evidence.","The case establishes effectiveness, population usability, or independent validation.","None","Ready with boundary","Method fit is supported, provided reflexive bias and the feasibility-only scope remain explicit."],
  ["C08","Jab performance is multi-joint and context dependent","S19; S20; S21","LE05; LE06; LE08","Partially supported","P001 traces demonstrate that the implemented coaching logic considers elbow, shoulder, guard and ordered movement context.","The chosen degree thresholds are universal, clinically valid, or independently biomechanically validated.","EA06","Pending","Literature and expert traces support variable selection; threshold correctness lacks independent triangulation."],
  ["C09","STGAT name similarity is not task equivalence","S22","LE03; LE09","Supported with boundary","The pedestrian STGAT paper is retained only as a terminology exclusion and not as direct support for articulated pose prediction.","Pedestrian trajectory results validate ACP-STGAT or jab anticipation.","None","Ready with boundary","The exclusion is explicit in both literature and local claim control."],
];

const evidence = [
  ["LE01","Perception implementation","component_evidence.csv: P01, P02","research/architecture/component_evidence.csv","Implemented MediaPipe body, hand and face readiness signals","Functional implementation only; camera/viewpoint reliability not quantified"],
  ["LE02","Software verification","Frontend and backend verification","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx","129/129 frontend assertions across 23 files; 24/24 backend tests","Software correctness is not task accuracy"],
  ["LE03","ACP-STGAT evaluation","Frozen ACP evaluation package","research/outputs/acp_stgat/20260731T061529Z/RESULT_INTERPRETATION.md","Normalized MPJPE/ADE 0.07839 (SD 0.00155); FDE 0.13639 (SD 0.00237); 18.6% lower mean error than last pose; 21.6% lower than constant velocity; ONNX median 9.88 ms, p95 12.81 ms","Participant-held-out Human3.6M-17 benchmark; not jab-domain, physical-unit or full-pipeline evidence"],
  ["LE04","Phase classifier evaluation","Frozen generated-bootstrap package","research/outputs/phase_classifier/20260731T091140Z/RESULT_INTERPRETATION.md","Accuracy 0.87841; balanced accuracy 0.90841; macro F1 0.89155; ONNX median 5.74 ms, p95 30.49 ms","Generator-defined structure only; no real annotated boundary evaluation"],
  ["LE05","Framework implementation","L1-L4, situation awareness, biomechanics and deterministic coaching components","research/architecture/component_evidence.csv","Implemented temporal state, forecast gates, context packet and rule/template feedback","End-to-end comparative benefit and threshold calibration pending"],
  ["LE06","Controlled P001 case","Confirmed practice-42","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx","Three expert-confirmed clusters; 250 frames; 8.3 s; 96% tracking; 22 decoder-changed frames","Single researcher-expert self-validation; summary/rep-row inconsistency retained"],
  ["LE07","Database export","Full August 1 export and interpretation","research/outputs/framework_evaluation/20260801T143145Z_database_export/EXPORT_INTERPRETATION.md","42 practice sessions, 58 repetitions, 7,277 frames, 185 training sessions, 3,623 feedback events","Historical/development records are not a controlled sample; no condition or response-time labels"],
  ["LE08","Screenshot evidence","Categorized UI evidence","User-provided categorized Research folders and P001 analysis panel","78 restricted screenshots across Train, Practice, Analysis, Admin, Dashboard and Pages","Functional/visual evidence only; videos private and excluded"],
  ["LE09","Terminology control","Literature exclusion log","research/outputs/literature/20260801/Combat_Cognition_Verified_Literature_Matrix_v4.xlsx","S22 explicitly excluded from direct skeletal-pose support","No numerical result may be transferred from the pedestrian task"],
];

const wb = Workbook.create();
const summary = wb.worksheets.add("Reconciliation Summary");
const register = wb.worksheets.add("Claim Reconciliation");
const index = wb.worksheets.add("Local Evidence Index");
const rules = wb.worksheets.add("Decision Rules");
for (const sheet of [summary,register,index,rules]) sheet.showGridLines = false;

const claimHeaders = ["claim_id","controlled_claim","literature_sources","local_evidence_ids","classification","defensible_statement","prohibited_overclaim","action_id_for_next_gate","thesis_readiness","rationale"];
register.getRangeByIndexes(0,0,claims.length+1,claimHeaders.length).values = [claimHeaders,...claims];
register.tables.add(`A1:J${claims.length+1}`,true,"ClaimReconciliationTable");
register.freezePanes.freezeRows(1); register.freezePanes.freezeColumns(2);
register.getRange("A1:J1").format={fill:"#123047",font:{bold:true,color:"#FFFFFF"},wrapText:true,verticalAlignment:"center"};
register.getRange(`A2:J${claims.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:9,color:"#172B3A"}};
[11,43,19,18,21,52,52,18,20,48].forEach((w,i)=>register.getRangeByIndexes(0,i,claims.length+1,1).format.columnWidth=w);
register.getRange(`E2:E${claims.length+1}`).conditionalFormats.addCustom(`=LEFT(E2,9)="Supported"`,{fill:"#DDF2E3",font:{color:"#145A32",bold:true}});
register.getRange(`E2:E${claims.length+1}`).conditionalFormats.addCustom(`=LEFT(E2,9)="Partially"`,{fill:"#FFF2CC",font:{color:"#7A4E12",bold:true}});
register.getRange(`I2:I${claims.length+1}`).conditionalFormats.addCustom(`=LEFT(I2,5)="Ready"`,{fill:"#DDF2E3",font:{color:"#145A32",bold:true}});

const evidenceHeaders=["evidence_id","evidence_group","record","path_or_source","verified_observation","mandatory_limit"];
index.getRangeByIndexes(0,0,evidence.length+1,evidenceHeaders.length).values=[evidenceHeaders,...evidence];
index.tables.add(`A1:F${evidence.length+1}`,true,"LocalEvidenceTable"); index.freezePanes.freezeRows(1);
index.getRange("A1:F1").format={fill:"#244F62",font:{bold:true,color:"#FFFFFF"},wrapText:true};
index.getRange(`A2:F${evidence.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:9,color:"#172B3A"}};
[12,23,30,58,55,55].forEach((w,i)=>index.getRangeByIndexes(0,i,evidence.length+1,1).format.columnWidth=w);

summary.getRange("A1:H1").merge(); summary.getRange("A1").values=[["Combat Cognition — Literature-to-Local-Evidence Reconciliation"]];
summary.getRange("A2:H2").merge(); summary.getRange("A2").values=[["Frozen preparation register; P001 jab-only laptop-camera feasibility case. This is not thesis prose."]];
summary.getRange("A4:B10").values=[["Register date",new Date(2026,7,1)],["Controlled claims",null],["Supported with boundary",null],["Partially supported",null],["Unsupported",null],["Ready with boundary",null],["Pending next-gate action",null]];
summary.getRange("B4").format.numberFormat="yyyy-mm-dd";
summary.getRange("B5").formulas=[[`=COUNTA('Claim Reconciliation'!$A$2:$A$${claims.length+1})`]];
summary.getRange("B6").formulas=[[`=COUNTIF('Claim Reconciliation'!$E$2:$E$${claims.length+1},"Supported with boundary")`]];
summary.getRange("B7").formulas=[[`=COUNTIF('Claim Reconciliation'!$E$2:$E$${claims.length+1},"Partially supported")`]];
summary.getRange("B8").formulas=[[`=COUNTIF('Claim Reconciliation'!$E$2:$E$${claims.length+1},"Unsupported")`]];
summary.getRange("B9").formulas=[[`=COUNTIF('Claim Reconciliation'!$I$2:$I$${claims.length+1},"Ready with boundary")`]];
summary.getRange("B10").formulas=[[`=COUNTIF('Claim Reconciliation'!$I$2:$I$${claims.length+1},"Pending")`]];
summary.getRange("A12:H12").values=[["Authoritative case","Allowed outcome","Disallowed outcome","Operational feedback","Phase evidence","P001 evidence","Video handling","Next protocol gate"]];
summary.getRange("A13:H13").values=[["P001 researcher/developer/martial-arts expert; jab only; laptop camera","Expert feasibility/self-evaluation and bounded artifact evidence","Effectiveness, population generalization, independent validation or combined overall accuracy","Deterministic rule/template; no operational OpenAI LLM","Generated bootstrap only","practice-42: 3 confirmed clusters; self-validation","Private; excluded from report","Create unresolved evaluation-action register from EA01, EA02, EA04–EA06 plus cross-cutting gaps"]];
summary.getRange("A1:H1").format={fill:"#123047",font:{bold:true,color:"#FFFFFF",size:16}};
summary.getRange("A2:H2").format={fill:"#DCEAF2",font:{italic:true,color:"#35566B"}};
summary.getRange("A4:A10").format={fill:"#EAF2F6",font:{bold:true,color:"#123047"}};
summary.getRange("A12:H12").format={fill:"#2D6A78",font:{bold:true,color:"#FFFFFF"},wrapText:true};
summary.getRange("A13:H13").format={fill:"#F4F8FA",font:{color:"#172B3A"},wrapText:true,verticalAlignment:"top"};
summary.getRange("A1:H13").format.borders={preset:"outside",style:"thin",color:"#9FB8C5"};
summary.getRange("A1:H13").format.columnWidth=24; summary.getRange("B4:B10").format.columnWidth=45;
summary.getRange("1:1").format.rowHeight=31; summary.getRange("2:2").format.rowHeight=24; summary.getRange("12:12").format.rowHeight=34; summary.getRange("13:13").format.rowHeight=96;

const decisionRows=[
 ["Supported with boundary","Literature and local evidence directly justify a bounded feasibility, limitation, methodology or exclusion claim.","Boundary must appear beside the claim."],
 ["Partially supported","Some local evidence exists, but a required comparator, real-domain label, latency measure, independent review or validation is absent.","Use only the defensible statement; carry the action ID to the next protocol gate."],
 ["Unsupported","No adequate local evidence exists for the controlled claim.","Do not write as a result; redesign, evaluate, or move to future work."],
 ["Evidence hierarchy","Model, software, framework-case and literature evidence remain separate.","Never calculate or report a combined overall accuracy."],
 ["P001 scope","Researcher/developer/expert self-evaluation of one jab case.","Never call this participant usability, independent expert validation or population effectiveness."],
 ["Screenshots/videos","Screenshots are restricted functional evidence; recordings remain private.","Do not insert videos into the report or treat screenshots as accuracy proof."],
];
rules.getRangeByIndexes(0,0,decisionRows.length+1,3).values=[["rule","meaning","application"],...decisionRows];
rules.tables.add(`A1:C${decisionRows.length+1}`,true,"DecisionRulesTable");
rules.getRange("A1:C1").format={fill:"#7A4E12",font:{bold:true,color:"#FFFFFF"},wrapText:true};
rules.getRange(`A2:C${decisionRows.length+1}`).format={wrapText:true,verticalAlignment:"top",font:{size:10,color:"#172B3A"}};
[24,62,62].forEach((w,i)=>rules.getRangeByIndexes(0,i,decisionRows.length+1,1).format.columnWidth=w);

const scan=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"});
await fs.writeFile(path.join(outputDir,"formula_scan.ndjson"),scan.ndjson,"utf8");
for (const [sheetName,range,fileName] of [["Reconciliation Summary","A1:H13","reconciliation_summary.png"],["Claim Reconciliation",`A1:J${claims.length+1}`,"claim_reconciliation.png"],["Local Evidence Index",`A1:F${evidence.length+1}`,"local_evidence_index.png"],["Decision Rules",`A1:C${decisionRows.length+1}`,"decision_rules.png"]]) {
  const preview=await wb.render({sheetName,range,scale:1.1,format:"png"});
  await fs.writeFile(path.join(outputDir,fileName),new Uint8Array(await preview.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(path.join(outputDir,"Combat_Cognition_Claim_Reconciliation.xlsx"));
const checks=[];
for (const item of [["Reconciliation Summary","A1:H13"],["Claim Reconciliation",`A1:J${claims.length+1}`],["Local Evidence Index",`A1:F${evidence.length+1}`],["Decision Rules",`A1:C${decisionRows.length+1}`]]) {
  checks.push((await wb.inspect({kind:"table",range:`${item[0]}!${item[1]}`,include:"values,formulas",tableMaxRows:20,tableMaxCols:12})).ndjson);
}
await fs.writeFile(path.join(outputDir,"verification.ndjson"),checks.join("\n"),"utf8");
console.log("Exported claim reconciliation workbook");
