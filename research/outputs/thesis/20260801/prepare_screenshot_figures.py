from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / "research/outputs/framework_evaluation/20260801_screenshot_evidence"
OUT = ROOT / "research/figures/verified/20260802"
OUT.mkdir(parents=True, exist_ok=True)


def anonymize(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(image)
    w, h = image.size
    # Mask the signed-in account label while preserving interface controls.
    draw.rounded_rectangle((w * 0.886, h * 0.048, w * 0.949, h * 0.102), radius=max(4, h // 180), fill=(12, 15, 18))
    draw.text((w * 0.895, h * 0.064), "P001", fill=(230, 235, 238))
    return image


def save_single(source: str, target: str):
    anonymize(SRC / source).save(OUT / target, quality=94)


def save_pair(left: str, right: str, target: str, labels=("A", "B")):
    images = [anonymize(SRC / left), anonymize(SRC / right)]
    thumb_w = 1500
    resized = []
    for image in images:
        new_h = round(image.height * thumb_w / image.width)
        resized.append(image.resize((thumb_w, new_h), Image.Resampling.LANCZOS))
    gap = 30
    canvas = Image.new("RGB", (thumb_w * 2 + gap, max(i.height for i in resized)), "white")
    draw = ImageDraw.Draw(canvas)
    for index, image in enumerate(resized):
        x = index * (thumb_w + gap)
        canvas.paste(image, (x, 0))
        draw.rounded_rectangle((x + 18, 18, x + 82, 82), radius=10, fill=(255, 255, 255), outline=(30, 30, 30), width=2)
        draw.text((x + 40, 30), labels[index], fill=(0, 0, 0))
    canvas.save(OUT / target, quality=94)


def save_triptych(paths: list[str], target: str, labels=("A", "B", "C")):
    images = [anonymize(SRC / p) for p in paths]
    thumb_w = 1020
    resized = []
    for image in images:
        new_h = round(image.height * thumb_w / image.width)
        resized.append(image.resize((thumb_w, new_h), Image.Resampling.LANCZOS))
    gap = 24
    canvas = Image.new("RGB", (thumb_w * 3 + gap * 2, max(i.height for i in resized)), "white")
    draw = ImageDraw.Draw(canvas)
    for index, image in enumerate(resized):
        x = index * (thumb_w + gap)
        canvas.paste(image, (x, 0))
        draw.rounded_rectangle((x + 14, 14, x + 66, 66), radius=8, fill=(255, 255, 255), outline=(30, 30, 30), width=2)
        draw.text((x + 31, 24), labels[index], fill=(0, 0, 0))
    canvas.save(OUT / target, quality=94)


save_single("pages/when user open studio ask that mode.PNG", "F5_studio_mode_selection.png")
save_single("dashboard/dashboard-overview.PNG", "F6_dashboard_overview.png")
save_single("train-hard mode/4.PNG", "F7_train_hard_prioritized_correction.png")
save_single("train-hard mode/12.PNG", "F8_train_hard_voice_transition.png")
save_single("train-hard mode/14.PNG", "F9_train_hard_guard_correction.png")
save_pair("train-hard mode/18.PNG", "train-hard mode/19.PNG", "F10_train_hard_completion_restart.png")
save_single("train -easy mode/hand test.PNG", "F11_hand_tracking_test.png")
save_single("practice mode/1.PNG", "F12_practice_live_set.png")
save_single("practice mode/6 -pop up window.PNG", "F13_practice_post_session.png")
save_single("analysis mode/1.PNG", "F14_analysis_dashboard.png")
save_triptych(["admin/1.PNG", "admin/3.PNG", "admin/5.PNG"], "F15_admin_l1_l2_overlay.png")
save_triptych(["admin/7.PNG", "admin/8.PNG", "admin/10.PNG"], "F16_admin_diagnostics_layers.png")

print(OUT)
