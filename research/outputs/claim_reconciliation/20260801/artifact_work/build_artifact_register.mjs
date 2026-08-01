import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir=path.resolve("research/outputs/report_artifacts/20260801");
await fs.mkdir(outputDir,{recursive:true});

const figures=[
 ["F1","ACP-STGAT normalized prediction error by horizon","research/figures/verified/20260801/F1_acp_error_by_horizon.png","0cec8ec24a3822057a41030342a844bf123979be7f1293aa8f425dd388bcea13","Ready","Offline model evaluation","Results","Normalized coordinates; Human3.6M-17 benchmark; not millimetres, accuracy percentage or live jab evidence"],
 ["F2","Generated-bootstrap temporal phase confusion matrix","research/figures/verified/20260801/F2_phase_bootstrap_confusion_matrix.png","d6ce62823e3a3087f5b5a17ffd15514cc43d8e93a48e57498c4d0cbfdab765db","Ready with boundary","Generated-data pipeline validation","Results / pipeline verification","Generator-defined phase structure only; not real-human or real-jab phase accuracy"],
 ["F3","Combat Cognition implemented architecture and evidence flow","research/figures/verified/20260801/F3_combat_cognition_architecture_evidence_flow.png","16d71cb71f9c2b3e1af327ad8632d441615a7c41eab7f78f9e7a53da418db6fa","Ready","Architecture and evidence classification","Methodology / architecture","Solid boxes are implemented; dashed future LLM is not operational; evidence classes remain separate"],
 ["F4","P001 practice-42 post-session three-cluster timeline","research/figures/verified/20260801/F4_p001_practice42_three_cluster_timeline.png","d9182ad1ae90d691e6129bde3f28cbda0c9dc6f68c9c842f5ea20f45ac36bf71","Restricted—conditional","Single-case functional evidence","Framework case","Use only after identity/privacy review; expert self-validation, not independent ground truth"],
];

const captions=[
 ["F1","ACP-STGAT normalized prediction error across the 30-frame forecast horizon on the participant-held-out Human3.6M-17 evaluation protocol.","Error is reported in normalized coordinates. Model results are benchmark-specific and do not establish live jab prediction or physical-unit accuracy."],
 ["F2","Temporal phase-classifier confusion matrix for the generated-bootstrap evaluation set.","The matrix verifies generator-defined pipeline behaviour only and must not be interpreted as real-human or real-jab phase accuracy."],
 ["F3","Implemented Combat Cognition architecture and the evidence classes attached to each computational layer.","The operational coach uses deterministic rules/templates. The dashed LLM component is planned, not operational. Software, model, generated-data and P001 evidence are not combined into one accuracy measure."],
 ["F4","Post-session three-cluster timeline for the confirmed P001 practice-42 jab case.","P001 is the researcher/developer/martial-arts expert. Cluster confirmation is expert self-validation; use is conditional on final privacy review."],
];

const tables=[
 ["T1","Architecture component and evidence classification","research/architecture/component_evidence.csv","Ready","Methodology / architecture","Implementation status, evidence source, limitation and future work","Implemented does not mean empirically validated"],
 ["T2","ACP-STGAT offline metrics, baselines and robustness","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx — Model Metrics","Ready","Results","Normalized MPJPE/ADE, FDE, bone error, last pose, constant velocity, robustness and ONNX latency","Benchmark-specific normalized units; latency is model-only"],
 ["T3","Temporal phase generated-bootstrap metrics and robustness","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx — Model Metrics","Ready with boundary","Results / pipeline verification","Accuracy, balanced accuracy, macro/per-class F1, confusion and ONNX latency","Generated data only; no real boundary accuracy"],
 ["T4","Automated software verification","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx — Software Verification","Ready","Implementation verification","Frontend assertions, backend tests and checked contracts","Test success is not live coaching accuracy"],
 ["T5","P001 practice-42 evidence summary","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx — Framework Case","Ready with boundary","Framework case","Three confirmed clusters, 250 frames, 8.3 s, 96% tracking and 22 decoder changes","Single researcher-expert self-evaluation; application scores are not ground truth"],
 ["T6","Observed practice-42 data-layer inconsistency","research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx — Framework Case","Ready","Failure analysis","Canonical 3 reps, rule-engine 0 reps and one implausible-duration database repetition row","Preserve contradictory values; do not silently harmonize"],
 ["T7","Controlled claim readiness and evaluation-action disposition","research/outputs/claim_reconciliation/20260801/Combat_Cognition_Claim_Reconciliation.xlsx; research/outputs/evaluation_actions/20260801/Combat_Cognition_Evaluation_Action_Register.xlsx","Ready","Discussion / limitations planning","Four supported-with-boundary claims, five partial claims, four closed actions and eight open-bounded actions","No unsupported inference; open items must remain limitations/future evaluation"],
];

const appendices=[
 ["A1","Architecture and implementation evidence register","research/architecture/component_evidence.csv; research/architecture/design_knowledge_register.csv","Include","Remove repository-internal detail not useful to assessment; retain status and limits"],
 ["A2","ACP-STGAT provenance, metrics and robustness record","research/outputs/acp_stgat/20260731T061529Z/","Include selected tables","Exclude large checkpoints and model binaries; retain provenance and metric records"],
 ["A3","Temporal phase-classifier provenance and generated-data evaluation","research/outputs/phase_classifier/20260731T091140Z/","Include selected tables","State generated-bootstrap status prominently; exclude large binaries"],
 ["A4","Software verification summary","research/system-evaluation/ALGORITHMIC_AWARENESS_VERIFICATION.md; evidence consolidation software sheet","Include","Summarize assertions/tests; do not reproduce excessive raw console output"],
 ["A5","P001 feasibility protocol and anonymized case evidence","research/pilot-study/; confirmed practice-42 derived evidence; categorized screenshots","Restricted—curated only","Exclude recordings, identity and unnecessary screenshots; include only approved anonymized derivatives"],
 ["A6","Database export interpretation and retained failure mode","research/outputs/framework_evaluation/20260801T143145Z_database_export/EXPORT_INTERPRETATION.md","Include interpretation only","Exclude the 31.97 MB raw JSON and identifying movement tapes from the submitted report"],
 ["A7","Verified literature matrix and selected-claim extracts","research/outputs/literature/20260801/Combat_Cognition_Verified_Literature_Matrix_v4.xlsx","Include selected register","Use citation-ready entries; do not paste extensive copyrighted source text"],
 ["A8","Claim reconciliation, evaluation actions and evidence locks","research/outputs/claim_reconciliation/20260801/; research/outputs/evaluation_actions/20260801/","Include selected registers","Use as audit trail; keep preparation language separate from thesis prose"],
];

const exclusions=[
 ["X01","Original recordings","Privacy / user instruction","Exclude from report and appendices","Private evidence only"],
 ["X02","Raw 31.97 MB research export and landmark tapes","Potentially identifying movement data; disproportionate size","Exclude from submitted report","Retain locally with hash; cite interpretation/curated subset only"],
 ["X03","Historical/outlier session aggregates","Development and exploratory records lack controlled-condition labels","Exclude from headline results","May be referenced only as development history or failure availability"],
 ["X04","Unnecessary screenshots","Redundant and potentially identifying","Exclude","Use the minimum anonymized screenshots needed for functional illustration"],
 ["X05","OpenAI/LLM operational results","No operational LLM found","Exclude as achieved evidence","Future-work concept only"],
 ["X06","Combined overall accuracy","Incommensurable evidence tiers","Prohibited","Report model, software and framework-case evidence separately"],
];

const wb=Workbook.create();
const summary=wb.worksheets.add("Artifact Summary");
const fig=wb.worksheets.add("Figure Register");
const cap=wb.worksheets.add("Figure Captions");
const tab=wb.worksheets.add("Table Register");
const app=wb.worksheets.add("Appendix Register");
const exc=wb.worksheets.add("Exclusion Register");
for(const s of [summary,fig,cap,tab,app,exc]) s.showGridLines=false;

summary.getRange("A1:H1").merge(); summary.getRange("A1").values=[["Combat Cognition — Final Figure, Table and Appendix Register"]];
summary.getRange("A2:H2").merge(); summary.getRange("A2").values=[["Preparation step 3 artifact freeze. No thesis prose."]];
summary.getRange("A4:B11").values=[["Register date",new Date(2026,7,1)],["Figures",null],["Ready figures",null],["Restricted figures",null],["Tables",null],["Appendices",null],["Explicit exclusions",null],["Missing architecture figure","Resolved (F3)"]];
summary.getRange("B4").format.numberFormat="yyyy-mm-dd";
summary.getRange("B5").formulas=[[`=COUNTA('Figure Register'!$A$2:$A$${figures.length+1})`]];
summary.getRange("B6").formulas=[[`=COUNTIF('Figure Register'!$E$2:$E$${figures.length+1},"Ready")+COUNTIF('Figure Register'!$E$2:$E$${figures.length+1},"Ready with boundary")`]];
summary.getRange("B7").formulas=[[`=COUNTIF('Figure Register'!$E$2:$E$${figures.length+1},"Restricted—conditional")`]];
summary.getRange("B8").formulas=[[`=COUNTA('Table Register'!$A$2:$A$${tables.length+1})`]];
summary.getRange("B9").formulas=[[`=COUNTA('Appendix Register'!$A$2:$A$${appendices.length+1})`]];
summary.getRange("B10").formulas=[[`=COUNTA('Exclusion Register'!$A$2:$A$${exclusions.length+1})`]];
summary.getRange("A13:H13").values=[["Scope","Figure rule","Table rule","Appendix rule","P001","Model evidence","Operational output","Next gate"]];
summary.getRange("A14:H14").values=[["P001 · jab · laptop camera","Use only frozen/hash-identified files","Keep evidence tiers separate","Curate; do not dump raw evidence","Expert self-validation","Benchmark/generated/model-only labels required","Deterministic rule/template","University-format chapter plan and claim approval"]];
summary.getRange("A1:H1").format={fill:"#123047",font:{bold:true,color:"#FFFFFF",size:16}}; summary.getRange("A2:H2").format={fill:"#DCEAF2",font:{italic:true,color:"#35566B"}};
summary.getRange("A4:A11").format={fill:"#EAF2F6",font:{bold:true,color:"#123047"}}; summary.getRange("A13:H13").format={fill:"#2D6A78",font:{bold:true,color:"#FFFFFF"},wrapText:true};
summary.getRange("A14:H14").format={fill:"#F4F8FA",font:{color:"#172B3A"},wrapText:true,verticalAlignment:"top"}; summary.getRange("A1:H14").format.borders={preset:"outside",style:"thin",color:"#9FB8C5"};
summary.getRange("A1:H14").format.columnWidth=24; summary.getRange("B4:B11").format.columnWidth=42; summary.getRange("1:1").format.rowHeight=31; summary.getRange("14:14").format.rowHeight=72;

function makeTable(sheet,headers,rows,name,widths,color="#244F62"){
 sheet.getRangeByIndexes(0,0,rows.length+1,headers.length).values=[headers,...rows]; sheet.tables.add(`A1:${String.fromCharCode(64+headers.length)}${rows.length+1}`,true,name); sheet.freezePanes.freezeRows(1);
 sheet.getRangeByIndexes(0,0,1,headers.length).format={fill:color,font:{bold:true,color:"#FFFFFF"},wrapText:true}; sheet.getRangeByIndexes(1,0,rows.length,headers.length).format={wrapText:true,verticalAlignment:"top",font:{size:9,color:"#172B3A"}};
 widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,rows.length+1,1).format.columnWidth=w);
}
makeTable(fig,["figure_id","working_title","frozen_path","sha256","status","evidence_class","planned_use","mandatory_caption_boundary"],figures,"FinalFigureTable",[10,40,62,67,22,28,24,58]);
makeTable(cap,["figure_id","caption","mandatory_note"],captions,"FigureCaptionTable",[10,75,85],"#2D6A78");
makeTable(tab,["table_id","title","frozen_source","status","planned_use","content","mandatory_note"],tables,"FinalTableTable",[10,42,68,21,26,54,58]);
makeTable(app,["appendix_id","title","source","status","curation_rule"],appendices,"AppendixTable",[12,45,72,24,72],"#7A4E12");
makeTable(exc,["exclusion_id","artifact_or_claim","reason","decision","handling"],exclusions,"ExclusionTable",[13,38,55,32,65],"#7A3030");

const scan=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"});
await fs.writeFile(path.join(outputDir,"formula_scan.ndjson"),scan.ndjson,"utf8");
for(const [sheetName,range,fileName] of [["Artifact Summary","A1:H14","artifact_summary.png"],["Figure Register",`A1:H${figures.length+1}`,"figure_register.png"],["Figure Captions",`A1:C${captions.length+1}`,"figure_captions.png"],["Table Register",`A1:G${tables.length+1}`,"table_register.png"],["Appendix Register",`A1:E${appendices.length+1}`,"appendix_register.png"],["Exclusion Register",`A1:E${exclusions.length+1}`,"exclusion_register.png"]]){
 const preview=await wb.render({sheetName,range,scale:1.05,format:"png"}); await fs.writeFile(path.join(outputDir,fileName),new Uint8Array(await preview.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb); await xlsx.save(path.join(outputDir,"Combat_Cognition_Final_Artifact_Register.xlsx"));
const checks=[]; for(const [sheetName,range] of [["Artifact Summary","A1:H14"],["Figure Register",`A1:H${figures.length+1}`],["Figure Captions",`A1:C${captions.length+1}`],["Table Register",`A1:G${tables.length+1}`],["Appendix Register",`A1:E${appendices.length+1}`],["Exclusion Register",`A1:E${exclusions.length+1}`]]) checks.push((await wb.inspect({kind:"table",range:`${sheetName}!${range}`,include:"values,formulas",tableMaxRows:20,tableMaxCols:10})).ndjson);
await fs.writeFile(path.join(outputDir,"verification.ndjson"),checks.join("\n"),"utf8"); console.log("Exported final artifact register");
