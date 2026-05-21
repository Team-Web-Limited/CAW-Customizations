import frappe

def create_item_group(name):
    if not frappe.db.exists("Item Group", name):
        doc = frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": name,
            "parent_item_group": "All Item Groups",
            "is_group": 0
        })
        doc.insert()
        print(f"Created Item Group: {name}")

def create_item(item_code, item_name, item_group, stock_uom, is_stock_item=1, standard_rate=0.0):
    if not frappe.db.exists("Item", item_code):
        doc = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_name,
            "item_group": item_group,
            "stock_uom": stock_uom,
            "is_stock_item": is_stock_item,
            "valuation_rate": standard_rate,
            "standard_rate": standard_rate
        })
        doc.insert()
        print(f"Created Item: {item_code}")

def create_dimension_range(
    min_mm,
    max_mm,
    equivalent_ft,
    equivalent_inches=None,
    interval_set="Standard Glass",
    equivalent_inches_min=None,
    equivalent_inches_max=None
):
    if not frappe.db.exists("Dimension Range", {"min_mm": min_mm, "max_mm": max_mm, "interval_set": interval_set}):
        stored_inches_max = equivalent_inches_max if equivalent_inches_max is not None else (
            equivalent_inches if equivalent_inches is not None else equivalent_ft * 12
        )
        doc = frappe.get_doc({
            "doctype": "Dimension Range",
            "min_mm": min_mm,
            "max_mm": max_mm,
            "equivalent_ft": equivalent_ft,
            "equivalent_inches": stored_inches_max,
            "equivalent_inches_min": equivalent_inches_min if equivalent_inches_min is not None else round(min_mm / 25.4, 2),
            "equivalent_inches_max": stored_inches_max,
            "interval_set": interval_set,
        })
        doc.insert()

def create_ceiling_composition(component_name, ratio):
    if not frappe.db.exists("Ceiling Composition", {"component_name": component_name}):
        doc = frappe.get_doc({
            "doctype": "Ceiling Composition",
            "component_name": component_name,
            "ratio": ratio
        })
        doc.insert()

def create_price_list(name, buying_or_selling):
    if not frappe.db.exists("Price List", name):
        doc = frappe.get_doc({
            "doctype": "Price List",
            "price_list_name": name,
            "buying": 1 if buying_or_selling == "Buying" else 0,
            "selling": 1 if buying_or_selling == "Selling" else 0,
            "currency": frappe.defaults.get_global_default("currency") or "KES"
        })
        doc.insert()
        print(f"Created Price List: {name}")

def setup_seed_data():
    frappe.flags.in_install = True

    # 0. Price Lists
    create_price_list("Retail", "Selling")
    create_price_list("Wholesale", "Selling")
    create_price_list("Special", "Selling")

    # 1. Item Groups
    groups = ["Aluminium", "Glass", "Fittings", "Ceiling"]
    for g in groups:
        create_item_group(g)

    # 2. Service Items (for auto-generated glass rows)
    create_item("Glass Polishing", "Glass Polishing", "Glass", "Rft", 0, 20.0)
    create_item("Glass Hole Drilling", "Glass Hole Drilling", "Glass", "Nos", 0, 25.0)
    create_item("Glass Notching", "Glass Notching", "Glass", "Nos", 0, 25.0)
    create_item("Glass Sandblasting", "Glass Sandblasting", "Glass", "Square Foot", 0, 70.0)

    # 3. Product Items
    create_item("Ordinary Glass", "Ordinary Glass", "Glass", "Square Foot", 1, 90.0)
    create_item("Laminated Glass", "Laminated Glass", "Glass", "Square Foot", 1, 150.0)
    create_item("Ready Laminated Glass", "Ready Laminated Glass", "Glass", "Square Foot", 1, 200.0)
    create_item("Toughened Glass", "Toughened Glass", "Glass", "Square Foot", 1, 200.0)
    
    create_item("Acoustic Ceiling", "Acoustic Ceiling", "Ceiling", "Square Meter", 1, 800.0)
    
    # Optional sample items
    create_item("Sample Aluminium Profile", "Sample Aluminium Profile", "Aluminium", "Meter", 1, 500.0)
    create_item("Sample Fitting", "Sample Fitting", "Fittings", "Nos", 1, 150.0)

    # 4. Dimension Ranges
    ranges = [
        (150, 305, 1.0),
        (306, 450, 1.5),
        (451, 600, 2.0),
        (601, 750, 2.5),
        (751, 900, 3.0),
    ]
    for r in ranges:
        create_dimension_range(*r)
    print("Seeded Dimension Ranges")

    # 5. Ceiling Composition
    compositions = [
        ("4ftT", 2.5),
        ("2ftT", 2.5),
        ("Angle", 3.0),
        ("Board", 0.36)
    ]
    for c in compositions:
        create_ceiling_composition(*c)
    print("Seeded Ceiling Composition")

    # 6. Glass Pricing Settings
    settings = frappe.get_single("Glass Pricing Settings")
    settings.base_rate = 90
    settings.polishing_rate = 20
    settings.hole_rate = 25
    settings.notch_rate = getattr(settings, "notch_rate", 25) or 25
    settings.sandblast_rate = 70
    settings.save()
    print("Seeded Glass Pricing Settings")

    frappe.db.commit()

if __name__ == "__main__":
    setup_seed_data()
