"""Seed the stable martial-arts taxonomy roots and major sections."""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "fae4f6b8c923"
down_revision: Union[str, Sequence[str], None] = "f9d3e5b7c812"
branch_labels = None
depends_on = None

SECTIONS = {
    "flexibility-mobility": ("FLEXIBILITY & MOBILITY", ["Joint Mobility", "Dynamic Flexibility", "Static Flexibility", "Active Flexibility", "Martial-Specific Flexibility", "Mobility Drills"]),
    "conditioning-fitness": ("CONDITIONING & FITNESS", ["Strength", "Power", "Speed", "Endurance", "Agility", "Balance", "Coordination", "Reaction & Reflex"]),
    "technique-training": ("TECHNIQUE TRAINING", ["Stances", "Guard Positions", "Footwork", "Punching", "Kicking", "Knee Strikes", "Elbow Strikes", "Defense", "Clinch", "Throws & Takedowns", "Grappling", "Submissions", "Ground Striking", "Breakfalls & Recovery", "Movement Transitions"]),
    "meditation-posture": ("MEDITATION & POSTURE", ["Meditation", "Breathing", "Posture", "Relaxation", "Body Awareness"]),
    "forms": ("FORMS", ["Solo Forms", "Weapon Forms", "Partner Forms", "Technical Sequences", "Form Components"]),
    "weapons": ("WEAPONS", ["Sword", "Staff", "Nunchaku", "Stick", "Training Knife", "Other Traditional Weapons"]),
    "self-defense": ("SELF-DEFENSE", ["Awareness & Prevention", "Release & Escape", "Defensive Response", "Counterattack", "Control & Restraint", "Ground Survival", "Multiple-Opponent Awareness", "Scenario Training"]),
    "fighting": ("FIGHTING", ["Offensive Fighting", "Defensive Fighting", "Counter Fighting", "Distance / Range", "Timing", "Tactical Movement", "Feints & Deception", "Combinations", "Sparring", "Fight Strategy", "Fight Intelligence"]),
}

def slug(value: str) -> str:
    return "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())

def upgrade() -> None:
    bind = op.get_bind()
    root = bind.execute(sa.text("SELECT id FROM catalog_nodes WHERE slug='martial-arts'")) .scalar()
    if root is None:
        root = bind.execute(sa.text("INSERT INTO catalog_nodes (slug,name,node_type,sort_order,active) VALUES ('martial-arts','MARTIAL ARTS SYSTEM','root',0,true) RETURNING id")).scalar()
    for order, (key, (name, children)) in enumerate(SECTIONS.items(), 1):
        node_slug = f"martial-arts--{key}"
        node = bind.execute(sa.text("SELECT id FROM catalog_nodes WHERE slug=:slug"), {"slug": node_slug}).scalar()
        if node is None:
            node = bind.execute(sa.text("INSERT INTO catalog_nodes (slug,name,parent_id,node_type,sort_order,active) VALUES (:slug,:name,:parent,'category',:order,true) RETURNING id"), {"slug": node_slug, "name": name, "parent": root, "order": order}).scalar()
        for child_order, child in enumerate(children, 1):
            child_slug = f"{node_slug}--{slug(child)}"
            bind.execute(sa.text("INSERT INTO catalog_nodes (slug,name,parent_id,node_type,sort_order,active) VALUES (:slug,:name,:parent,'category',:order,true) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,active=true"), {"slug": child_slug, "name": child, "parent": node, "order": child_order})

def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM catalog_nodes WHERE slug='martial-arts' OR slug LIKE 'martial-arts--%'"))
