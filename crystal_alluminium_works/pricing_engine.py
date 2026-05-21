import frappe
from frappe import _
from math import trunc

STANDARD_GLASS_INTERVAL_SET = "Standard Glass"
TOUGHENED_GLASS_INTERVAL_SET = "Toughened Glass"
GLASS_SERVICE_ITEM_DEFS = {
    "Glass Polishing": {"item_name": "Glass Polishing", "uom": "Rft"},
    "Glass Hole Drilling": {"item_name": "Glass Hole Drilling", "uom": "Nos"},
    "Glass Notching": {"item_name": "Glass Notching", "uom": "Nos"},
    "Glass Sandblasting": {"item_name": "Glass Sandblasting", "uom": "Square Foot"},
}


def _dimension_range_has_field(fieldname):
    return frappe.db.has_column("Dimension Range", fieldname)

@frappe.whitelist()
def calculate_dimensions(width_mm, height_mm, glass_type=None, item_code=None):
    glass_type = glass_type or (frappe.db.get_value("Item", item_code, "custom_glass_type") if item_code else None)
    w_ft = mm_to_ft(float(width_mm), glass_type=glass_type) if width_mm else 0.0
    h_ft = mm_to_ft(float(height_mm), glass_type=glass_type) if height_mm else 0.0
    return {
        "width_ft": w_ft,
        "height_ft": h_ft,
        "area_sqft": w_ft * h_ft,
        "perimeter_rft": 2 * (w_ft + h_ft)
    }

def get_interval_set_for_glass_type(glass_type):
    return TOUGHENED_GLASS_INTERVAL_SET if glass_type == "Toughened" else STANDARD_GLASS_INTERVAL_SET


def get_polish_side_counts(row):
    width_sides = frappe.utils.cint(getattr(row, "custom_polish_width_sides", 0) or 0)
    height_sides = frappe.utils.cint(getattr(row, "custom_polish_height_sides", 0) or 0)

    # Backward compatibility for old rows that only stored a yes/no polishing flag.
    if not width_sides and not height_sides and getattr(row, "custom_polishing", 0):
        return 2, 2

    return width_sides, height_sides


def get_polishing_rft(width_rft, height_rft, qty=1, polish_width_sides=0, polish_height_sides=0, polishing=0):
    width_sides = frappe.utils.cint(polish_width_sides or 0)
    height_sides = frappe.utils.cint(polish_height_sides or 0)

    if not width_sides and not height_sides and polishing:
        width_sides = 2
        height_sides = 2

    value = frappe.utils.flt(qty or 0) * (
        (width_sides * frappe.utils.flt(width_rft or 0)) +
        (height_sides * frappe.utils.flt(height_rft or 0))
    )
    return trunc(value * 1000) / 1000


def mm_to_piece_rft(mm_value):
    return frappe.utils.flt(mm_value or 0) / 305


def mm_to_ft(mm_value, glass_type=None):
    if not mm_value: return 0.0
    interval_set = get_interval_set_for_glass_type(glass_type)
    fields = ["min_mm", "max_mm", "equivalent_ft", "equivalent_inches"]
    if _dimension_range_has_field("equivalent_inches_max"):
        fields.append("equivalent_inches_max")

    ranges = frappe.get_all(
        "Dimension Range",
        filters={"interval_set": interval_set},
        fields=fields
    )
    for r in ranges:
        if r.min_mm <= mm_value <= r.max_mm:
            equivalent_inches = frappe.utils.flt(
                getattr(r, "equivalent_inches_max", 0) or getattr(r, "equivalent_inches", 0)
            )
            if equivalent_inches:
                return equivalent_inches / 12.0
            return r.equivalent_ft
    # Fallback or strict mapping? The requirements didn't specify out of range.
    # Let's use strict math if out of range, or we can just divide by 304.8
    return float(mm_value) / 304.8


def ensure_glass_service_item(item_code):
    service_meta = GLASS_SERVICE_ITEM_DEFS.get(item_code)
    if not service_meta:
        return

    if frappe.db.exists("Item", item_code):
        if frappe.db.get_value("Item", item_code, "disabled"):
            frappe.db.set_value("Item", item_code, "disabled", 0)
        return

    if not frappe.db.exists("UOM", service_meta["uom"]):
        frappe.get_doc({
            "doctype": "UOM",
            "uom_name": service_meta["uom"],
        }).insert(ignore_permissions=True)

    if not frappe.db.exists("Item Group", "Glass"):
        frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": "Glass",
            "parent_item_group": "All Item Groups",
            "is_group": 0,
        }).insert(ignore_permissions=True)

    item = frappe.get_doc({
        "doctype": "Item",
        "item_code": item_code,
        "item_name": service_meta["item_name"],
        "item_group": "Glass",
        "stock_uom": service_meta["uom"],
        "is_stock_item": 0,
        "include_item_in_manufacturing": 0,
        "standard_rate": 0,
        "uoms": [{"uom": service_meta["uom"], "conversion_factor": 1}],
    })
    item.insert(ignore_permissions=True)


def ensure_glass_service_items():
    for item_code in GLASS_SERVICE_ITEM_DEFS:
        ensure_glass_service_item(item_code)

def process_glass_item(row, parent_idx):
    """
    Computes dimensions, sets base rate for the glass row, 
    and returns a list of dictionaries for service items.
    """
    sale_mode = getattr(row, "custom_glass_sale_mode", "Resized")
    glass_qty = frappe.utils.flt(getattr(row, "qty", 0) or 1)
    
    if sale_mode == "Full Sheet":
        # Skip dimension logic, use standard item pricing
        base_rate = (frappe.get_cached_value("Item", row.item_code, "standard_rate") or 0.0) / 1.16
        row.rate = base_rate
        row.amount = glass_qty * row.rate
        return []

    if not row.custom_width_mm or not row.custom_height_mm:
        return []

    glass_type = frappe.get_cached_value("Item", row.item_code, "custom_glass_type")
    base_width_ft = mm_to_ft(row.custom_width_mm, glass_type=glass_type)
    base_height_ft = mm_to_ft(row.custom_height_mm, glass_type=glass_type)
    width_allowance = frappe.utils.flt(getattr(row, "custom_width_allowance", 0) or 0)
    height_allowance = frappe.utils.flt(getattr(row, "custom_height_allowance", 0) or 0)
    width_ft = base_width_ft + width_allowance
    height_ft = base_height_ft + height_allowance
    
    area_sqft = width_ft * height_ft
    perimeter_rft = get_polishing_rft(
        mm_to_piece_rft(row.custom_width_mm),
        mm_to_piece_rft(row.custom_height_mm),
        glass_qty,
        getattr(row, "custom_polish_width_sides", 0),
        getattr(row, "custom_polish_height_sides", 0),
        getattr(row, "custom_polishing", 0),
    )
    
    # Update row computed fields
    row.custom_base_width_ft = base_width_ft
    row.custom_base_height_ft = base_height_ft
    row.custom_width_ft = width_ft
    row.custom_height_ft = height_ft
    row.custom_area_sqft = area_sqft
    row.custom_perimeter_rft = perimeter_rft
    
    settings = frappe.get_single("Glass Pricing Settings")
    
    # Keep qty as the number of pieces and expand the per-piece rate from the computed area.
    base_rate = (frappe.get_cached_value("Item", row.item_code, "standard_rate") or settings.base_rate) / 1.16
    row.rate = area_sqft * base_rate
    row.amount = glass_qty * row.rate
    
    auto_rows = []

    # Mirror accounting dimensions from the parent row so generated
    # service lines behave like normal invoice items during submit.
    shared_row_values = {
        "description": getattr(row, "description", None) or getattr(row, "item_name", None),
        "income_account": getattr(row, "income_account", None),
        "cost_center": getattr(row, "cost_center", None),
    }
    
    # Services are optional and can apply to any glass item.
    polish_width_sides, polish_height_sides = get_polish_side_counts(row)
    if polish_width_sides or polish_height_sides:
        ensure_glass_service_item("Glass Polishing")
        rate = float(settings.polishing_rate or 0) / 1.16
        polishing_qty = get_polishing_rft(
            mm_to_piece_rft(row.custom_width_mm),
            mm_to_piece_rft(row.custom_height_mm),
            glass_qty,
            polish_width_sides,
            polish_height_sides,
            getattr(row, "custom_polishing", 0),
        )
        auto_rows.append({
            "item_code": "Glass Polishing",
            "item_name": "Glass Polishing",
            "uom": "Rft",
            "conversion_factor": 1.0,
            "qty": polishing_qty,
            "ordered_qty": 0.0,
            "rate": rate,
            "amount": polishing_qty * rate,
            "custom_auto_generated": 1,
            "custom_parent_row_idx": parent_idx
        } | shared_row_values)
        
    # Holes
    if row.custom_holes:
        ensure_glass_service_item("Glass Hole Drilling")
        rate = float(settings.hole_rate or 0) / 1.16
        hole_qty = glass_qty * frappe.utils.flt(row.custom_holes or 0)
        auto_rows.append({
            "item_code": "Glass Hole Drilling",
            "item_name": "Glass Hole Drilling",
            "uom": "Nos",
            "conversion_factor": 1.0,
            "qty": hole_qty,
            "ordered_qty": 0.0,
            "rate": rate,
            "amount": hole_qty * rate,
            "custom_auto_generated": 1,
            "custom_parent_row_idx": parent_idx
        } | shared_row_values)

    # Notches
    if getattr(row, "custom_notches", 0):
        ensure_glass_service_item("Glass Notching")
        rate = float(getattr(settings, "notch_rate", 0) or 0) / 1.16
        notch_qty = glass_qty * frappe.utils.flt(getattr(row, "custom_notches", 0) or 0)
        auto_rows.append({
            "item_code": "Glass Notching",
            "item_name": "Glass Notching",
            "uom": "Nos",
            "conversion_factor": 1.0,
            "qty": notch_qty,
            "ordered_qty": 0.0,
            "rate": rate,
            "amount": notch_qty * rate,
            "custom_auto_generated": 1,
            "custom_parent_row_idx": parent_idx
        } | shared_row_values)
        
    # Sandblast
    if row.custom_sandblast_type in ["Half", "Full"]:
        ensure_glass_service_item("Glass Sandblasting")
        rate = float(settings.sandblast_rate or 0) / 1.16
        qty = glass_qty * area_sqft
        if row.custom_sandblast_type == "Half":
            qty = qty / 2.0
            
        auto_rows.append({
            "item_code": "Glass Sandblasting",
            "item_name": "Glass Sandblasting",
            "uom": "Square Foot",
            "conversion_factor": 1.0,
            "qty": qty,
            "ordered_qty": 0.0,
            "rate": rate,
            "amount": qty * rate,
            "custom_auto_generated": 1,
            "custom_parent_row_idx": parent_idx
        } | shared_row_values)
            
    return auto_rows

def calculate_ceiling_pricing(row, parent_idx):
    # Acoustic ceiling: rate = 800 per sqm
    base_rate = (frappe.get_cached_value("Item", row.item_code, "standard_rate") or 800.0) / 1.16
    row.rate = base_rate
    row.amount = row.qty * row.rate
    
    # Return empty list because we are not generating individual component items yet
    return []
