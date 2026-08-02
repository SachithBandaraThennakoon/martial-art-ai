from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "research/outputs/framework_evaluation/20260801_screenshot_evidence"
OUTPUT = ROOT / "research/Appendix/A4-System-Interface-and-Functional-Evidence"

SELECTIONS = {
    "01-studio-mode-selection.png": "pages/when user open studio ask that mode.PNG",
    "02-dashboard-overview-and-filters.png": "dashboard/dashboard-overview.PNG",
    "03-train-hard-prioritized-elbow-correction.png": "train-hard mode/4.PNG",
    "04-train-hard-voice-step-transition.png": "train-hard mode/12.PNG",
    "05-train-hard-guard-related-shoulder-correction.png": "train-hard mode/14.PNG",
    "06a-train-hard-session-complete.png": "train-hard mode/18.PNG",
    "06b-train-hard-session-restarted.png": "train-hard mode/19.PNG",
    "07-easy-mode-hand-tracking-diagnostic.png": "train -easy mode/hand test.PNG",
    "08-practice-mode-live-set.png": "practice mode/1.PNG",
    "09-practice-mode-full-session-analysis.png": "practice mode/practice-42-full-session-analysis-cropped.png",
    "10-analysis-mode-dashboard.png": "analysis mode/1.PNG",
    "11a-admin-level1-hand-up.png": "admin/1.PNG",
    "11b-admin-level2-hand-up.png": "admin/3.PNG",
    "11c-admin-level1-level2-combined.png": "admin/5.PNG",
    "12a-admin-live-session-diagnostics.png": "admin/7.PNG",
    "12b-admin-level2-action-analysis.png": "admin/8.PNG",
    "12c-admin-multilevel-data-layers.png": "admin/10.PNG",
    "13-dashboard-activity.png": "dashboard/dashboard-activity.PNG",
    "14-dashboard-performance.png": "dashboard/dashboard-performance.PNG",
    "15-dashboard-techniques.png": "dashboard/dashboard-Tecniques.PNG",
    "16-dashboard-sessions.png": "dashboard/dashboard-sessions.PNG",
    "17-analysis-selected-session-timeline.png": "analysis mode/2.PNG",
    "18-analysis-coach-pattern.png": "analysis mode/3.PNG",
    "19-easy-mode-ready-or-wait.png": "train -easy mode/1.PNG",
    "20-easy-mode-quantified-shoulder-correction.png": "train -easy mode/4.PNG",
    "21-easy-mode-next-step-transition.png": "train -easy mode/7.PNG",
    "22-easy-mode-hold-confirmation.png": "train -easy mode/8.PNG",
    "23-easy-mode-next-repeat-wait-choice.png": "train -easy mode/10.PNG",
    "24-easy-mode-return-to-guard.png": "train -easy mode/11.PNG",
    "25-easy-mode-session-complete.png": "train -easy mode/12.PNG",
    "26-practice-analysis-selected-moment-entry.png": "practice mode/7.PNG",
    "27-practice-analysis-preparation-frame.png": "practice mode/10.PNG",
    "28-practice-analysis-peak-frame.png": "practice mode/12.PNG",
    "29-practice-analysis-recovery-frame.png": "practice mode/14.PNG",
    "29a-practice-analysis-rep1-step3-hold.png": "practice mode/8.PNG",
    "29b-practice-analysis-rep1-complete.png": "practice mode/9.PNG",
    "29c-practice-analysis-rep2-step1-hold.png": "practice mode/11.PNG",
    "29d-practice-analysis-rep2-complete.png": "practice mode/13.PNG",
    "30-train-hard-ready-or-wait.png": "train-hard mode/2.PNG",
    "31-train-hard-elbow-away-from-target.png": "train-hard mode/5.PNG",
    "32-train-hard-quantified-shoulder-correction.png": "train-hard mode/7.PNG",
    "33-train-hard-elbow-too-closed.png": "train-hard mode/13.PNG",
    "34-technique-training-catalog.png": "pages/Technique training page(example).PNG",
    "35-studio-landing-page.png": "pages/studio page.PNG",
    "36-admin-level1-walk.png": "admin/2.PNG",
    "37-admin-level2-walk.png": "admin/4.PNG",
    "38-admin-level1-level2-combined-hand.png": "admin/6.PNG",
    "39-admin-level2-observing-state.png": "admin/9.PNG",
    "40-admin-data-layer-detail.png": "admin/11.PNG",
    "41-admin-additional-data-layer-detail.png": "admin/12.PNG",
    "42-admin-skeleton-lab-test.png": "admin/Skeleton lab test.PNG",
}

OBSOLETE_COMPOSITES = {
    "06-train-hard-completion-and-restart.png",
    "11-admin-level1-level2-skeleton-overlay.png",
    "12-admin-diagnostics-and-data-layers.png",
}


def anonymize(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGB")
    draw = ImageDraw.Draw(image)
    width, height = image.size
    draw.rounded_rectangle(
        (width * 0.886, height * 0.048, width * 0.949, height * 0.102),
        radius=max(4, height // 180),
        fill=(12, 15, 18),
    )
    draw.text((width * 0.895, height * 0.064), "P001", fill=(230, 235, 238))
    return image


OUTPUT.mkdir(parents=True, exist_ok=True)
for obsolete in OBSOLETE_COMPOSITES:
    target = OUTPUT / obsolete
    if target.exists():
        target.unlink()

for target_name, source_name in SELECTIONS.items():
    anonymize(SOURCE / source_name).save(OUTPUT / target_name)

print(f"Prepared {len(SELECTIONS)} separate A9 screenshots in {OUTPUT}")
