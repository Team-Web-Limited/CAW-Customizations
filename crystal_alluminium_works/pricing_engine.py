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
GLASS_POLISH_RATE_TYPES = {
    "4-6": "polishing_rate_4_6",
    "8-10": "polishing_rate_8_10",
    "14-35": "polishing_rate_14_35",
}
GLASS_HOLE_RATE_TYPES = {
    "5mm": "hole_rate_5mm",
    "6mm": "hole_rate_6mm",
    "8mm": "hole_rate_8mm",
    "10mm": "hole_rate_10mm",
    "15mm": "hole_rate_15mm",
    "20mm": "hole_rate_20mm",
}
GLASS_NOTCH_RATE_TYPES = {
    "Standard": "notch_rate_standard",
    "Small": "notch_rate_small",
    "Mirror Screws": "notch_rate_mirror_screws",
    "Timber Box": "notch_rate_timber_box",
}
DEFAULT_GLASS_POLISH_TYPE = "4-6"
DEFAULT_GLASS_HOLE_TYPE = "5mm"
DEFAULT_GLASS_NOTCH_TYPE = "Standard"

CEILING_COMPONENTS = [
    {"item_code": "Board", "ratio": 0.36, "mode": "divide", "uses_parent_item": True},
    {"item_code": "MainT", "ratio": 0.25, "mode": "multiply"},
    {"item_code": "Sub Cross 4ft", "ratio": 1.33, "mode": "multiply"},
    {"item_code": "Sub Cross 2ft", "ratio": 1.33, "mode": "multiply"},
    {"item_code": "Wall angle", "ratio": 0.25, "mode": "multiply"},
]
LEGACY_CEILING_ITEM_ALIASES = {
    "SC4ft": "Sub Cross 4ft",
    "SC2ft": "Sub Cross 2ft",
    "WA": "Wall angle",
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


def normalize_glass_service_type(value, rate_types, default_type):
    value = (value or "").strip()
    return value if value in rate_types else default_type


def get_glass_service_rate(settings, rate_types, selected_type, default_type, fallback_fieldname):
    service_type = normalize_glass_service_type(selected_type, rate_types, default_type)
    fieldname = rate_types[service_type]
    rate = getattr(settings, fieldname, None)

    if rate is None or rate == "":
        rate = getattr(settings, fallback_fieldname, 0)

    return service_type, frappe.utils.flt(rate or 0) / 1.16


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


def ensure_ceiling_component_items():
    """
    Ensure standard ceiling component Items exist in the Item master.
    Creates simple non-stock service items under Item Group 'Ceiling' with UOM 'Nos'.
    """
    # ensure UOM exists
    if not frappe.db.exists("UOM", "Nos"):
        frappe.get_doc({
            "doctype": "UOM",
            "uom_name": "Nos",
        }).insert(ignore_permissions=True)

    # ensure Item Group exists
    if not frappe.db.exists("Item Group", "Ceiling"):
        frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": "Ceiling",
            "parent_item_group": "All Item Groups",
            "is_group": 0,
        }).insert(ignore_permissions=True)

    cleanup_legacy_ceiling_item_aliases()

    for comp in CEILING_COMPONENTS:
        if comp.get("uses_parent_item"):
            continue

        item_code = comp.get("item_code")
        if not item_code:
            continue

        if frappe.db.exists("Item", item_code):
            item_doc = frappe.get_doc("Item", item_code)
            # Un-disable if present but disabled
            if item_doc.disabled:
                item_doc.disabled = 0
            if item_doc.stock_uom != "Nos":
                item_doc.stock_uom = "Nos"
            item_doc.set("uoms", [{"uom": "Nos", "conversion_factor": 1}])
            item_doc.save(ignore_permissions=True)
            if frappe.get_meta("Item").has_field("custom_product_code"):
                frappe.db.set_value("Item", item_code, "custom_product_code", "C01", update_modified=False)
            continue

        item = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_code,
            "item_group": "Ceiling",
            "stock_uom": "Nos",
            "is_stock_item": 0,
            "include_item_in_manufacturing": 0,
            "standard_rate": 0,
            "uoms": [{"uom": "Nos", "conversion_factor": 1}],
        })
        if frappe.get_meta("Item").has_field("custom_product_code"):
            item.custom_product_code = "C01"
        try:
            item.insert(ignore_permissions=True)
        except Exception:
            # best-effort: skip on any failure
            pass


def cleanup_legacy_ceiling_item_aliases():
    for legacy_code, canonical_code in LEGACY_CEILING_ITEM_ALIASES.items():
        if not frappe.db.exists("Item", legacy_code):
            continue
        if not frappe.db.exists("Item", canonical_code):
            continue

        migrate_legacy_ceiling_item_alias_data(legacy_code, canonical_code)

        # Remove old aliases entirely when the canonical ceiling item exists.
        # This keeps the catalog editable and avoids users seeing duplicate names.
        try:
            frappe.delete_doc("Item", legacy_code, ignore_permissions=True, force=1)
        except Exception:
            if not frappe.db.get_value("Item", legacy_code, "disabled"):
                frappe.db.set_value("Item", legacy_code, "disabled", 1, update_modified=False)


def migrate_legacy_ceiling_item_alias_data(legacy_code, canonical_code):
    legacy_standard_rate = frappe.utils.flt(frappe.db.get_value("Item", legacy_code, "standard_rate") or 0)
    canonical_standard_rate = frappe.utils.flt(frappe.db.get_value("Item", canonical_code, "standard_rate") or 0)
    if legacy_standard_rate and not canonical_standard_rate:
        frappe.db.set_value("Item", canonical_code, "standard_rate", legacy_standard_rate, update_modified=False)

    legacy_prices = frappe.get_all(
        "Item Price",
        filters={"item_code": legacy_code, "price_list": ("in", ["Retail", "Wholesale", "Special"])},
        fields=["price_list", "price_list_rate"],
    )
    for legacy_price in legacy_prices:
        price_list = legacy_price.get("price_list")
        legacy_rate = frappe.utils.flt(legacy_price.get("price_list_rate") or 0)
        if not price_list or not legacy_rate:
            continue

        canonical_price_name = frappe.db.get_value(
            "Item Price",
            {"item_code": canonical_code, "price_list": price_list},
            "name",
        )
        canonical_rate = frappe.utils.flt(
            frappe.db.get_value(
                "Item Price",
                {"item_code": canonical_code, "price_list": price_list},
                "price_list_rate",
            ) or 0
        )
        if canonical_price_name:
            if not canonical_rate:
                frappe.db.set_value("Item Price", canonical_price_name, "price_list_rate", legacy_rate, update_modified=False)
            continue

        item_price = frappe.get_doc({
            "doctype": "Item Price",
            "item_code": canonical_code,
            "price_list": price_list,
            "price_list_rate": legacy_rate,
            "selling": 1,
        })
        item_price.insert(ignore_permissions=True)


def get_item_rate(item_code, price_list=None, fallback_rate=0):
    price_list = price_list or "Retail"
    rate = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "price_list_rate",
    )
    if rate is None:
        rate = frappe.get_cached_value("Item", item_code, "standard_rate")
    return frappe.utils.flt(rate if rate is not None else fallback_rate)


def get_ceiling_piece_qty(quantity, ratio, mode):
    quantity = frappe.utils.flt(quantity or 0)
    ratio = frappe.utils.flt(ratio or 0)
    if not quantity or not ratio:
        return 0
    if mode == "divide":
        return quantity / ratio
    return quantity * ratio


def get_ceiling_whole_piece_qty(quantity, ratio, mode):
    piece_qty = get_ceiling_piece_qty(quantity, ratio, mode)
    return int(piece_qty)


def process_glass_item(row, parent_idx):
    """
    Computes dimensions, sets base rate for the glass row, 
    and returns a list of dictionaries for service items.
    """
    sale_mode = getattr(row, "custom_glass_sale_mode", "Resized")
    glass_qty = frappe.utils.flt(getattr(row, "qty", 0) or 1)
    
    if sale_mode == "Sheet":
        # Builder sheet rows already carry the selected square-foot rate.
        row.amount = glass_qty * frappe.utils.flt(row.rate or 0)
        return []

    if sale_mode == "Full Sheet":
        # Skip dimension logic, use standard item pricing.
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
        polish_type, rate = get_glass_service_rate(
            settings,
            GLASS_POLISH_RATE_TYPES,
            getattr(row, "custom_polish_type", None),
            DEFAULT_GLASS_POLISH_TYPE,
            "polishing_rate",
        )
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
            "item_name": f"Glass Polishing ({polish_type})",
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
        hole_type, rate = get_glass_service_rate(
            settings,
            GLASS_HOLE_RATE_TYPES,
            getattr(row, "custom_hole_type", None),
            DEFAULT_GLASS_HOLE_TYPE,
            "hole_rate",
        )
        hole_qty = glass_qty * frappe.utils.flt(row.custom_holes or 0)
        auto_rows.append({
            "item_code": "Glass Hole Drilling",
            "item_name": f"Glass Hole Drilling ({hole_type})",
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
        notch_type, rate = get_glass_service_rate(
            settings,
            GLASS_NOTCH_RATE_TYPES,
            getattr(row, "custom_notch_type", None),
            DEFAULT_GLASS_NOTCH_TYPE,
            "notch_rate",
        )
        notch_qty = glass_qty * frappe.utils.flt(getattr(row, "custom_notches", 0) or 0)
        auto_rows.append({
            "item_code": "Glass Notching",
            "item_name": f"Glass Notching ({notch_type})",
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
    quantity = frappe.utils.flt(getattr(row, "custom_ceiling_sq_m", 0) or getattr(row, "qty", 0) or 100)
    price_list = "Wholesale" if frappe.utils.flt(getattr(row, "custom_ceiling_sq_m", 0) or 0) else "Retail"
    if not frappe.utils.flt(getattr(row, "custom_ceiling_sq_m", 0) or 0):
        row.amount = frappe.utils.flt(getattr(row, "qty", 0) or 0) * frappe.utils.flt(getattr(row, "rate", 0) or 0)
        return []

    board_component = next((component for component in CEILING_COMPONENTS if component.get("uses_parent_item")), None)
    parent_rate = get_item_rate(row.item_code, price_list, fallback_rate=800.0) / 1.16
    row.qty = 1
    row.rate = quantity * parent_rate
    row.amount = row.qty * row.rate

    ensure_ceiling_component_items()

    shared_row_values = {
        "description": getattr(row, "description", None) or getattr(row, "item_name", None),
        "income_account": getattr(row, "income_account", None),
        "cost_center": getattr(row, "cost_center", None),
    }

    auto_rows = []
    for component in CEILING_COMPONENTS:
        if component.get("uses_parent_item"):
            continue

        item_code = component.get("item_code")
        piece_qty = get_ceiling_whole_piece_qty(quantity, component["ratio"], component["mode"])
        auto_rows.append({
            "item_code": item_code,
            "item_name": frappe.get_cached_value("Item", item_code, "item_name") or item_code,
            "uom": frappe.get_cached_value("Item", item_code, "stock_uom") or "Nos",
            "conversion_factor": 1.0,
            "qty": piece_qty,
            "ordered_qty": 0.0,
            "rate": 0.0,
            "amount": 0.0,
            "custom_auto_generated": 1,
            "custom_parent_row_idx": parent_idx,
            "custom_product_category": "Ceiling",
            "custom_price_list": price_list,
        } | shared_row_values)

    return auto_rows
