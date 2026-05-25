import frappe
import json
from frappe.model.rename_doc import rename_doc
from frappe.utils.file_manager import save_file
from frappe.utils import flt
from crystal_alluminium_works.pricing_engine import GLASS_SERVICE_ITEM_DEFS, ensure_glass_service_items
from crystal_alluminium_works.create_custom_fields import GLASS_SALE_MODE_OPTIONS
from crystal_alluminium_works.setup_glass_sheet_config import run_setup as setup_glass_sheet_config

GLASS_TYPE_OPTIONS = ["Ordinary", "Laminated", "Ready Laminated", "Toughened"]
ALUMINIUM_PRODUCT_CODE = "A01"
GLASS_CATEGORY_TO_TYPE = {
    "Ordinary Glass": "Ordinary",
    "Laminated Glass": "Laminated",
    "Ready Laminated Glass": "Ready Laminated",
    "Toughened Glass": "Toughened",
}
GLASS_TYPE_TO_PRODUCT_CODE = {
    "Ordinary": "OG",
    "Laminated": "LG",
    "Ready Laminated": "RLG",
    "Toughened": "TG",
}
CATEGORY_PRODUCT_CODES = {
    "Fittings": "F01",
    "Ceiling": "C01",
    "Rubber": "R01",
    "Silicone": "S01",
}
PRICE_TYPE_TO_PRICE_LIST = {
    "retail": "Retail",
    "wholesale": "Wholesale",
    "special": "Special",
}
ALUMINIUM_BUILDER_PRICE_LIST_MAP = {
    "Normal Price": "Retail",
    "Mill Finished Price": "Wholesale",
    "Special Price": "Special",
    "Retail": "Retail",
    "Wholesale": "Wholesale",
    "Special": "Special",
}
STANDARD_GLASS_INTERVAL_SET = "Standard Glass"
TOUGHENED_GLASS_INTERVAL_SET = "Toughened Glass"
VAT_RATE = 0.16
ALUMINIUM_PRICE_FACTOR = 1.07
GLASS_SHEET_CONFIG_TYPES = ("Ordinary", "Ready Laminated")


def _dimension_range_has_field(fieldname):
    return frappe.db.has_column("Dimension Range", fieldname)


def _doc_has_field(doctype, fieldname):
    return frappe.get_meta(doctype).has_field(fieldname)


def _ensure_aluminium_color_storage():
    _ensure_aluminium_color_doctype()
    if _doc_has_field("Quotation Item", "custom_aluminium_color"):
        return

    from crystal_alluminium_works.create_custom_fields import add_custom_fields
    add_custom_fields()
    for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
        frappe.clear_cache(doctype=doctype)


def _ensure_aluminium_pricing_storage():
    required_fields = (
        "custom_aluminium_rate_per_kg",
        "custom_aluminium_weight_per_length",
    )
    if all(_item_has_field(fieldname) for fieldname in required_fields):
        return

    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_aluminium_rate_per_kg",
                "label": "Aluminium Rate Per Kg",
                "fieldtype": "Currency",
                "default": 0,
                "insert_after": "custom_product_code",
                "depends_on": "eval:doc.item_group=='Aluminium'",
            },
            {
                "fieldname": "custom_aluminium_weight_per_length",
                "label": "Aluminium Weight Per Length",
                "fieldtype": "Float",
                "default": 0,
                "insert_after": "custom_aluminium_rate_per_kg",
                "depends_on": "eval:doc.item_group=='Aluminium'",
            },
        ]
    })
    frappe.clear_cache(doctype="Item")


def _ensure_glass_sheet_config_storage():
    setup_glass_sheet_config()


def _ensure_glass_sale_mode_options():
    from crystal_alluminium_works.create_custom_fields import add_custom_fields

    for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
        custom_field_name = frappe.db.exists("Custom Field", {"dt": doctype, "fieldname": "custom_glass_sale_mode"})
        if not custom_field_name:
            continue

        current_options = frappe.db.get_value("Custom Field", custom_field_name, "options") or ""
        if current_options == GLASS_SALE_MODE_OPTIONS:
            continue

        custom_field = frappe.get_doc("Custom Field", custom_field_name)
        custom_field.options = GLASS_SALE_MODE_OPTIONS
        custom_field.save(ignore_permissions=True)
        frappe.clear_cache(doctype=doctype)

    required_sheet_fields = ("custom_sheet_size", "custom_sheet_sft", "custom_sheet_pcs")
    if not all(_doc_has_field("Quotation Item", fieldname) for fieldname in required_sheet_fields):
        add_custom_fields()
        for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
            frappe.clear_cache(doctype=doctype)


def _normalize_glass_sheet_type(glass_type):
    glass_type = (glass_type or "").strip()
    if glass_type not in GLASS_SHEET_CONFIG_TYPES:
        frappe.throw("Glass sheet configuration is only supported for Ordinary and Ready Laminated.")
    return glass_type


def _ensure_glass_type_options():
    """Keep the Item custom glass type field aligned with supported values."""
    custom_field_name = frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"})
    if not custom_field_name:
        return

    options = "\n".join(GLASS_TYPE_OPTIONS)
    current_options = frappe.db.get_value("Custom Field", custom_field_name, "options") or ""
    if current_options == options:
        return

    custom_field = frappe.get_doc("Custom Field", custom_field_name)
    custom_field.options = options
    custom_field.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Item")


def _item_has_field(fieldname):
    return frappe.get_meta("Item").has_field(fieldname)


def _get_aluminium_price_components(rate_per_kg=0, weight_per_length=0):
    normal_price = flt(rate_per_kg) * flt(weight_per_length)
    mill_finished_price = normal_price / ALUMINIUM_PRICE_FACTOR if ALUMINIUM_PRICE_FACTOR else normal_price
    special_price = normal_price * ALUMINIUM_PRICE_FACTOR
    return {
        "normal_price": flt(normal_price),
        "mill_finished_price": flt(mill_finished_price),
        "special_price": flt(special_price),
    }


def _normalize_aluminium_type(value, fallback=None):
    # Aluminium is no longer split into colored vs non-colored variants.
    return None


def _is_glass_service_item(item_name):
    item_name = (item_name or "").strip().lower()
    return any(keyword in item_name for keyword in (
        "polishing",
        "drilling",
        "sandblasting",
        "hole",
        "notching",
        "notch",
    )) 


def _invoice_uses_visual_vat(doc):
    return flt(getattr(doc, "total_taxes_and_charges", 0) or 0) == 0


def _get_invoice_display_amount(amount, doc):
    amount = flt(amount)
    return amount * (1 + VAT_RATE) if _invoice_uses_visual_vat(doc) else amount


def _get_invoice_accounting_amount(amount, doc):
    amount = flt(amount)
    return amount / (1 + VAT_RATE) if _invoice_uses_visual_vat(doc) else amount


def _get_product_code(category, glass_type=None, aluminium_type=None, item_name=None):
    storage_category = _get_storage_category(category)

    if storage_category == "Glass":
        if _is_glass_service_item(item_name):
            return None
        return GLASS_TYPE_TO_PRODUCT_CODE.get(_get_glass_type_for_category(category, glass_type))

    if storage_category == "Aluminium":
        return ALUMINIUM_PRODUCT_CODE

    return CATEGORY_PRODUCT_CODES.get(storage_category)


def _normalize_price_type(value):
    normalized = (value or "").strip().lower()
    return PRICE_TYPE_TO_PRICE_LIST.get(normalized)


def _get_selling_rate(item_code, price_list):
    item_price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "price_list_rate"
    )
    return frappe.utils.flt(item_price or frappe.get_cached_value("Item", item_code, "standard_rate") or 0.0)


def _get_builder_price_list(category, price_list):
    if category == "Aluminium":
        return ALUMINIUM_BUILDER_PRICE_LIST_MAP.get(price_list or "", "Retail")
    return price_list or "Retail"


def _get_item_price_rate(item_code, price_list):
    return frappe.utils.flt(
        frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list, "selling": 1},
            "price_list_rate"
        ) or 0
    )


def _get_single_config_docname(doctype, item_code, original_item_code=None):
    config_name = frappe.db.get_value(doctype, {"parent_item": item_code}, "name")
    if config_name:
        return config_name

    if original_item_code and original_item_code != item_code and frappe.db.exists(doctype, original_item_code):
        return original_item_code

    return None


def _get_builder_item_by_product_code(product_code, allowed_groups=None):
    product_code = (product_code or "").strip().upper()
    if not product_code:
        frappe.throw("Product code is required for import.")

    allowed_groups = allowed_groups or ["Glass", "Aluminium"]
    filters = {
        "item_group": ["in", allowed_groups],
        "custom_product_code": product_code,
    }
    items = frappe.get_all(
        "Item",
        filters=filters,
        fields=["name", "item_code", "item_name", "stock_uom", "item_group", "custom_glass_type"],
    )
    items = [
        item for item in items
        if not (item.get("item_group") == "Glass" and _is_glass_service_item(item.get("item_name")))
    ]

    if not items:
        group_label = " or ".join(allowed_groups)
        frappe.throw(f"No {group_label} item was found for product code {product_code}.")
    if len(items) > 1:
        names = ", ".join(item.item_code for item in items)
        frappe.throw(f"Product code {product_code} matches multiple items: {names}.")

    return items[0]


def _get_builder_item_by_item_code(item_code, product_code=None, allowed_groups=None):
    item_code = (item_code or "").strip()
    if not item_code:
        frappe.throw("Item code is required for this import row.")

    item = frappe.db.get_value(
        "Item",
        item_code,
        ["name", "item_code", "item_name", "stock_uom", "item_group", "custom_product_code", "custom_glass_type"],
        as_dict=True,
    )
    if not item:
        frappe.throw(f"No item was found for item code {item_code}.")

    if allowed_groups and item.item_group not in allowed_groups:
        group_label = ", ".join(allowed_groups)
        frappe.throw(f"Item code {item_code} must belong to one of: {group_label}.")

    expected_product_code = (product_code or "").strip().upper()
    if expected_product_code and (item.custom_product_code or "").strip().upper() != expected_product_code:
        frappe.throw(f"Item code {item_code} does not match product code {expected_product_code}.")

    return item


def _get_builder_aluminium_item(item_code, product_code=None):
    expected_product_code = (product_code or "").strip().upper()
    if expected_product_code and not expected_product_code.startswith("A"):
        frappe.throw(f"Product code {expected_product_code} is not valid for an aluminium row.")

    return _get_builder_item_by_item_code(item_code, expected_product_code, ["Aluminium"])


def _ensure_uom_exists(uom_name):
    """Create the UOM master on demand so item saves don't fail on missing setup."""
    uom_name = (uom_name or "").strip()
    if not uom_name or frappe.db.exists("UOM", uom_name):
        return

    frappe.get_doc({
        "doctype": "UOM",
        "uom_name": uom_name,
    }).insert(ignore_permissions=True)


def _ensure_item_group_exists(group_name):
    """Create catalog item groups on demand for new manage-items tabs."""
    group_name = (group_name or "").strip()
    if not group_name or frappe.db.exists("Item Group", group_name):
        return

    frappe.get_doc({
        "doctype": "Item Group",
        "item_group_name": group_name,
        "parent_item_group": "All Item Groups",
        "is_group": 0,
    }).insert(ignore_permissions=True)


def _ensure_price_list_exists(price_list):
    """Create selling price lists lazily so item price saves do not get skipped."""
    price_list = (price_list or "").strip()
    if not price_list or frappe.db.exists("Price List", price_list):
        return

    frappe.get_doc({
        "doctype": "Price List",
        "price_list_name": price_list,
        "buying": 0,
        "selling": 1,
        "currency": frappe.defaults.get_global_default("currency") or "KES",
    }).insert(ignore_permissions=True)


def _ensure_aluminium_color_doctype():
    if frappe.db.exists("DocType", "Aluminium Color"):
        return

    doc = frappe.get_doc({
        "doctype": "DocType",
        "name": "Aluminium Color",
        "module": "Crystal Alluminium Works",
        "custom": 0,
        "editable_grid": 1,
        "autoname": "field:color_name",
        "fields": [
            {"fieldname": "color_name", "fieldtype": "Data", "label": "Color", "reqd": 1, "in_list_view": 1, "unique": 1}
        ],
        "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    frappe.clear_cache(doctype="Aluminium Color")


def _ensure_item_has_default_uom(item, uom_name):
    """Keep the item's conversion table aligned with its stock UOM."""
    uom_name = (uom_name or "").strip()
    if not uom_name:
        return

    current_uoms = [row.uom for row in item.get("uoms") or []]
    if uom_name not in current_uoms:
        item.append("uoms", {"uom": uom_name, "conversion_factor": 1})


def _get_category_uom(category):
    """Return the canonical UOM name used by ERPNext seed data and transactions."""
    if category == "Aluminium":
        return "Meter"
    if category in GLASS_CATEGORY_TO_TYPE or category == "Glass":
        return "Square Foot"
    if category == "Ceiling":
        return "Square Meter"
    return "Nos"


def _get_storage_category(category):
    """Map UI-facing categories to the stored ERPNext item group."""
    return "Glass" if category in GLASS_CATEGORY_TO_TYPE else category


def _get_glass_type_for_category(category, fallback=None):
    """Resolve the glass type represented by a UI category."""
    if category in GLASS_CATEGORY_TO_TYPE:
        return GLASS_CATEGORY_TO_TYPE[category]
    if fallback in GLASS_TYPE_OPTIONS:
        return fallback
    return "Ordinary"


def _get_default_company():
    """Resolve a usable company for transactions created outside standard forms."""
    company = (
        frappe.defaults.get_user_default("Company")
        or frappe.defaults.get_global_default("company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
    )
    if company:
        return company

    enabled_companies = frappe.get_all("Company", filters={"disabled": 0}, pluck="name", limit=2)
    if len(enabled_companies) == 1:
        return enabled_companies[0]

    frappe.throw("Please specify Company.")


def _get_interval_set_for_glass_type(glass_type):
    glass_type = (glass_type or "").strip()
    if glass_type == "Toughened":
        return TOUGHENED_GLASS_INTERVAL_SET
    return STANDARD_GLASS_INTERVAL_SET


def _normalize_import_header(value):
    header = str(value or "").strip().lower().replace(" ", "_")
    if header == "item_code":
        return "code"
    return header


def _is_empty_import_row(row):
    return not any(str(cell or "").strip() for cell in row)


def _get_import_cell(row, index):
    if index is None or index < 0:
        return None
    return row[index] if index < len(row) else None


def _clean_import_text(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value or "").strip()


def _build_xlsx_file(filename, rows):
    from frappe.utils.xlsxutils import make_xlsx

    xlsx_file = make_xlsx(rows, filename)
    file_doc = save_file(
        f"{filename}.xlsx",
        xlsx_file.getvalue(),
        dt=None,
        dn=None,
        is_private=0,
    )
    return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}


def _normalize_builder_sheet_header(value):
    header = str(value or "").strip().lower().replace("(", "").replace(")", "")
    header = header.replace("/", " ").replace("-", " ").replace(".", " ")
    return "_".join(part for part in header.split() if part)


@frappe.whitelist()
def get_sales_orders_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["customer"] = customer
    if from_date:
        filters["transaction_date"] = [">=", from_date]
    if to_date:
        if "transaction_date" in filters and isinstance(filters["transaction_date"], list):
            filters["transaction_date"] = ["between", [from_date, to_date]]
        else:
            filters["transaction_date"] = ["<=", to_date]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Sales Order", "name", "like", like],
                ["Sales Order", "customer", "like", like],
                ["Sales Order", "customer_name", "like", like],
                ["Sales Order", "po_no", "like", like],
            ]

    fields = [
        "name",
        "customer",
        "customer_name",
        "transaction_date",
        "delivery_date",
        "grand_total",
        "currency",
        "status",
        "docstatus",
        "creation",
    ]

    rows = frappe.get_list(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_quotations_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["party_name"] = customer
    if from_date:
        filters["transaction_date"] = [">=", from_date]
    if to_date:
        if "transaction_date" in filters and isinstance(filters["transaction_date"], list):
            filters["transaction_date"] = ["between", [from_date, to_date]]
        else:
            filters["transaction_date"] = ["<=", to_date]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Quotation", "name", "like", like],
                ["Quotation", "party_name", "like", like],
                ["Quotation", "customer_name", "like", like],
                ["Quotation", "order_type", "like", like],
            ]

    fields = [
        "name",
        "party_name",
        "customer_name",
        "transaction_date",
        "valid_till",
        "grand_total",
        "currency",
        "status",
        "docstatus",
        "creation",
    ]

    rows = frappe.get_list(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_sales_invoices_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20, payment_mode=None):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["customer"] = customer
    if from_date:
        filters["posting_date"] = [">=", from_date]
    if to_date:
        if "posting_date" in filters and isinstance(filters["posting_date"], list):
            filters["posting_date"] = ["between", [from_date, to_date]]
        else:
            filters["posting_date"] = ["<=", to_date]

    if payment_mode:
        paid_invoices_sql = """
            select distinct reference_name
            from `tabPayment Entry Reference` per
            inner join `tabPayment Entry` pe on pe.name = per.parent
            where per.reference_doctype = 'Sales Invoice'
              and pe.mode_of_payment = %s
              and pe.docstatus < 2
        """
        if payment_mode == "Cash":
            rows_cash = frappe.db.sql(paid_invoices_sql, ("Cash",), as_dict=False)
            cash_invoice_names = [r[0] for r in rows_cash] if rows_cash else []
            filters["name"] = ["in", cash_invoice_names] if cash_invoice_names else ["=", ""]
        elif payment_mode == "Cheque":
            rows_cash = frappe.db.sql(paid_invoices_sql, ("Cash",), as_dict=False)
            cash_invoice_names = [r[0] for r in rows_cash] if rows_cash else []
            if cash_invoice_names:
                filters["name"] = ["not in", cash_invoice_names]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Sales Invoice", "name", "like", like],
                ["Sales Invoice", "customer", "like", like],
                ["Sales Invoice", "customer_name", "like", like],
                ["Sales Invoice", "custom_source_quotation", "like", like],
                ["Sales Invoice", "remarks", "like", like],
            ]

    fields = [
        "name",
        "customer",
        "customer_name",
        "posting_date",
        "due_date",
        "grand_total",
        "total_taxes_and_charges",
        "outstanding_amount",
        "currency",
        "status",
        "docstatus",
        "custom_source_quotation",
        "update_stock",
        "creation",
        "customer.tax_id as pin",
    ]

    rows = frappe.get_list(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }

@frappe.whitelist()
def create_quotation_from_builder(customer, items, quotation_name=None):
    """
    Creates or updates a Draft Quotation from the Quotation Builder payload.
    Items is a JSON string of the builder's item list.
    Each item carries its own price_list for per-item pricing.
    The standard on_validate hook in quotation_handler.py will 
    auto-generate glass service rows when the quotation is saved.

    If quotation_name is provided, the existing quotation is updated
    instead of creating a new one (used by the "Edit in Builder" flow).
    """
    items = json.loads(items) if isinstance(items, str) else items
    
    if not items:
        frappe.throw("Please add at least one item.")

    if any(item.get("category") == "Aluminium" for item in items):
        _ensure_aluminium_color_storage()
    if any(item.get("category") == "Glass" for item in items):
        _ensure_glass_sale_mode_options()
    
    # Use the first item's selected selling price as the quotation-level default.
    default_price_list = _get_builder_price_list(
        items[0].get("category", ""),
        items[0].get("price_list", "Retail"),
    ) if items else "Retail"
    company = _get_default_company()

    if quotation_name:
        # ── Update existing quotation ──
        quo = frappe.get_doc("Quotation", quotation_name)
        if quo.docstatus != 0:
            frappe.throw("Only Draft quotations can be edited via the Builder.")
        quo.party_name = customer
        quo.company = quo.company or company
        quo.selling_price_list = default_price_list
        quo.items = []  # Clear existing items — they'll be rebuilt below
    else:
        # ── Create new quotation ──
        quo = frappe.get_doc({
            "doctype": "Quotation",
            "quotation_to": "Customer",
            "party_name": customer,
            "company": company,
            "selling_price_list": default_price_list,
            "items": []
        })
    
    for item in items:
        category = item.get("category", "")
        row_price_list = _get_builder_price_list(category, item.get("price_list"))
        row_data = {
            "item_code": item.get("item_code"),
            "qty": item.get("qty", 1),
            "rate": frappe.utils.flt(item.get("rate", 0)) / 1.16,
            "custom_price_list": row_price_list,
            "custom_product_category": category,
        }

        if item.get("description"):
            row_data["description"] = item.get("description")
        
        # Glass-specific custom fields
        if item.get("category") == "Glass":
            sale_mode = item.get("sale_mode", "Resized")
            sandblast = item.get("sandblast_type", "")
            polish_width_sides = frappe.utils.cint(item.get("polish_width_sides", 0))
            polish_height_sides = frappe.utils.cint(item.get("polish_height_sides", 0))
            
            row_data.update({
                "custom_product_category": "Glass",
                "custom_glass_sale_mode": sale_mode,
                "custom_width_mm": item.get("width_mm", 0),
                "custom_height_mm": item.get("height_mm", 0),
                "custom_base_width_ft": item.get("base_width_ft", 0),
                "custom_base_height_ft": item.get("base_height_ft", 0),
                "custom_width_ft": item.get("width_ft", 0),
                "custom_height_ft": item.get("height_ft", 0),
                "custom_width_allowance": item.get("width_allowance", 0),
                "custom_height_allowance": item.get("height_allowance", 0),
                "custom_area_sqft": 0 if sale_mode == "Sheet" else item.get("area_sqft", 0),
                "custom_perimeter_rft": item.get("perimeter_rft", 0),
                "custom_polishing": 1 if (
                    item.get("polishing") in [1, True, "1", "Yes"] or
                    polish_width_sides > 0 or polish_height_sides > 0
                ) else 0,
                "custom_polish_width_sides": polish_width_sides,
                "custom_polish_height_sides": polish_height_sides,
                "custom_holes": frappe.utils.cint(item.get("holes", 0)),
                "custom_notches": frappe.utils.cint(item.get("notches", 0)),
                "custom_sandblast_type": "" if sandblast == "None" else sandblast,
                "custom_numbering": item.get("numbering", ""),
                "custom_sheet_size": item.get("sheet_size", "") if sale_mode == "Sheet" else "",
                "custom_sheet_sft": frappe.utils.flt(item.get("sheet_sft", 0)) if sale_mode == "Sheet" else 0,
                "custom_sheet_pcs": frappe.utils.flt(item.get("pcs", 0)) if sale_mode == "Sheet" else 0,
            })
            row_data["qty"] = item.get("qty", 1.0)
        elif category == "Aluminium":
            metres = frappe.utils.flt(item.get("metres", 1) or 1)
            row_data.update({
                "custom_aluminium_metres": metres,
            })
            row_data["custom_aluminium_color"] = item.get("aluminium_color") or None
        elif category == "Ceiling":
            square_metres = frappe.utils.flt(item.get("square_metres", 1) or 1)
            rate_per_sq_m = frappe.utils.flt(item.get("rate", 0)) / 1.16
            row_data.update({
                "rate": square_metres * rate_per_sq_m,
                "custom_ceiling_sq_m": square_metres,
            })

        quo.append("items", row_data)
    
    quo.flags.ignore_mandatory = True
    quo.set_missing_values()

    if quotation_name:
        quo.save(ignore_permissions=True)
    else:
        quo.insert(ignore_permissions=True)
    
    # Return the name so the frontend can redirect
    return quo.name

@frappe.whitelist()
def submit_quotation(name):
    ensure_glass_service_items()
    quotation = frappe.get_doc("Quotation", name)
    quotation.submit()
    return quotation.name


@frappe.whitelist()
def make_sales_order_from_quotation(source_name):
    from erpnext.selling.doctype.quotation.quotation import _make_sales_order
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Quotation", source_name)
    so = _make_sales_order(source_name, ignore_permissions=True)
    
    if not so.items:
        frappe.throw("A Sales Order has already been fully created for this Quotation.")

    _copy_aluminium_color_between_rows(source_doc.items, so.items)
        
    so.skip_delivery_note = 1
    so.flags.ignore_permissions = True
    so.flags.ignore_mandatory = True
    so.insert()
    so.submit()
    return so.name


@frappe.whitelist()
def make_sales_invoice_from_quotation(source_name):
    from erpnext.selling.doctype.quotation.quotation import _make_sales_invoice
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Quotation", source_name)

    invoice = _make_sales_invoice(source_name, ignore_permissions=True)

    if not invoice.items:
        frappe.throw("A Sales Invoice has already been fully created for this Quotation.")

    if hasattr(invoice, "custom_source_quotation"):
        invoice.custom_source_quotation = source_name

    _copy_aluminium_color_between_rows(source_doc.items, invoice.items)

    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.set_missing_values()
    invoice.set_missing_item_details(for_validate=True)
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True
    invoice.insert()
    return invoice.name


@frappe.whitelist()
def make_sales_invoice_from_sales_order(source_name):
    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Sales Order", source_name)

    invoice = make_sales_invoice(source_name, ignore_permissions=True)

    if not invoice.items:
        frappe.throw("A Sales Invoice has already been fully created for this Sales Order.")

    quotation_name = frappe.db.get_value(
        "Sales Order Item",
        {"parent": source_name, "prevdoc_docname": ["is", "set"]},
        "prevdoc_docname",
    )
    if quotation_name and hasattr(invoice, "custom_source_quotation"):
        invoice.custom_source_quotation = quotation_name

    _copy_aluminium_color_between_rows(source_doc.items, invoice.items)

    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.set_missing_values()
    invoice.set_missing_item_details(for_validate=True)
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True
    invoice.insert()
    return invoice.name


@frappe.whitelist()
def submit_sales_invoice(name):
    ensure_glass_service_items()
    invoice = frappe.get_doc("Sales Invoice", name)
    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.submit()
    return invoice.name


@frappe.whitelist()
def cancel_sales_invoice(name):
    invoice = frappe.get_doc("Sales Invoice", name)
    invoice.cancel()
    return invoice.name


def _ensure_cheque_mode_of_payment(company):
    if company != "Crystall-Aluminium-Works":
        return
    if not frappe.db.exists("Mode of Payment Account", {"parent": "Cheque", "company": company}):
        if frappe.db.exists("Mode of Payment", "Cheque"):
            default_account = "Bank Accounts - CAW"
            if frappe.db.exists("Account", default_account):
                try:
                    doc = frappe.get_doc("Mode of Payment", "Cheque")
                    doc.append("accounts", {
                        "company": company,
                        "default_account": default_account
                    })
                    doc.save(ignore_permissions=True)
                    frappe.db.commit()
                except Exception:
                    pass


@frappe.whitelist()
def get_company_mode_of_payments(company):
    if not company:
        frappe.throw("Company is required.")

    _ensure_cheque_mode_of_payment(company)

    rows = frappe.db.sql(
        """
        select
            mpa.parent as mode_of_payment,
            mpa.default_account,
            mp.type
        from `tabMode of Payment Account` mpa
        inner join `tabMode of Payment` mp on mp.name = mpa.parent
        where mpa.company = %s
        order by mpa.parent asc
        """,
        (company,),
        as_dict=True,
    )

    return rows


@frappe.whitelist()
def record_sales_invoice_payment(invoice_name, amount, mode_of_payment, posting_date=None, reference_date=None):
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account

    if not invoice_name:
        frappe.throw("Sales Invoice is required.")
    if not mode_of_payment:
        frappe.throw("Mode of Payment is required.")

    amount = flt(amount)
    if amount <= 0:
        frappe.throw("Amount Received must be greater than zero.")

    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    if invoice.docstatus != 1:
        frappe.throw("Only submitted Sales Invoices can accept payments.")

    invoice.reload()
    outstanding_amount = flt(invoice.outstanding_amount)
    display_outstanding_amount = _get_invoice_display_amount(outstanding_amount, invoice)
    if display_outstanding_amount <= 0:
        frappe.throw("This Sales Invoice has no outstanding amount left.")
    if amount > display_outstanding_amount + 0.01:
        frappe.throw(f"Amount Received cannot exceed the outstanding amount of {display_outstanding_amount}.")

    accounting_amount = flt(_get_invoice_accounting_amount(amount, invoice), 2)
    if abs(amount - display_outstanding_amount) <= 0.01:
        accounting_amount = flt(outstanding_amount, 2)
    else:
        accounting_amount = min(accounting_amount, flt(outstanding_amount, 2))

    bank_cash_account = get_bank_cash_account(mode_of_payment, invoice.company).get("account")
    payment_entry = get_payment_entry(
        "Sales Invoice",
        invoice.name,
        party_amount=accounting_amount,
        bank_account=bank_cash_account,
        reference_date=reference_date or posting_date,
    )

    payment_entry.mode_of_payment = mode_of_payment
    if posting_date:
        payment_entry.posting_date = posting_date
    if reference_date:
        payment_entry.reference_date = reference_date

    payment_entry.remarks = (
        f"Payment Entry against Sales Invoice {invoice.name} for {amount} via {mode_of_payment}"
    )
    payment_entry.flags.ignore_permissions = True
    payment_entry.insert(ignore_permissions=True)
    payment_entry.submit()

    updated_invoice = frappe.get_doc("Sales Invoice", invoice.name)
    updated_invoice.reload()

    return {
        "payment_entry": payment_entry.name,
        "invoice": updated_invoice.name,
        "outstanding_amount": updated_invoice.outstanding_amount,
        "display_outstanding_amount": _get_invoice_display_amount(updated_invoice.outstanding_amount, updated_invoice),
        "status": updated_invoice.status,
    }


@frappe.whitelist()
def delete_all_sales_orders():
    def clear_missing_quotation_links(sales_order):
        for row in sales_order.items:
            quotation_name = row.get("prevdoc_docname")
            if quotation_name and not frappe.db.exists("Quotation", quotation_name):
                frappe.db.set_value(
                    "Sales Order Item",
                    row.name,
                    {
                        "prevdoc_docname": None,
                        "quotation_item": None,
                    },
                    update_modified=False,
                )
                row.prevdoc_docname = None
                row.quotation_item = None

    sales_order_names = frappe.get_all(
        "Sales Order",
        filters={"docstatus": ["<", 2]},
        pluck="name",
        order_by="creation desc",
    )

    deleted = []
    for sales_order_name in sales_order_names:
        sales_order = frappe.get_doc("Sales Order", sales_order_name)
        if sales_order.docstatus == 1:
            clear_missing_quotation_links(sales_order)
            sales_order.cancel()

        frappe.delete_doc("Sales Order", sales_order_name, ignore_permissions=True, force=1)
        deleted.append(sales_order_name)

    cancelled_only = frappe.get_all(
        "Sales Order",
        filters={"docstatus": 2},
        pluck="name",
        order_by="creation desc",
    )
    for sales_order_name in cancelled_only:
        frappe.delete_doc("Sales Order", sales_order_name, ignore_permissions=True, force=1)
        deleted.append(sales_order_name)

    return {"deleted_count": len(deleted), "deleted_sales_orders": deleted}


@frappe.whitelist()
def delete_all_quotations():
    quotation_names = frappe.get_all(
        "Quotation",
        filters={"docstatus": ["<", 2]},
        pluck="name",
        order_by="creation desc",
    )

    deleted = []
    for quotation_name in quotation_names:
        quotation = frappe.get_doc("Quotation", quotation_name)
        if quotation.docstatus == 1:
            quotation.cancel()

        frappe.delete_doc("Quotation", quotation_name, ignore_permissions=True, force=1)
        deleted.append(quotation_name)

    cancelled_only = frappe.get_all(
        "Quotation",
        filters={"docstatus": 2},
        pluck="name",
        order_by="creation desc",
    )
    for quotation_name in cancelled_only:
        frappe.delete_doc("Quotation", quotation_name, ignore_permissions=True, force=1)
        deleted.append(quotation_name)

    return {"deleted_count": len(deleted), "deleted_quotations": deleted}

@frappe.whitelist()
def calculate_glass_total(item_code, price_list, qty, sale_mode, width_mm, height_mm,
                          polishing=None, holes=0, sandblast_type=None,
                          polish_width_sides=0, polish_height_sides=0, notches=0,
                          width_allowance=0, height_allowance=0):
    """
    Calculates the full composite total for a Glass item in the Quotation Builder,
    including glass base cost and all applicable service costs (polishing, drilling, sandblasting).
    Returns a breakdown so the frontend can display and store the correct total.
    """
    from crystal_alluminium_works.pricing_engine import mm_to_ft, mm_to_piece_rft, get_polishing_rft

    width_mm = float(width_mm or 0)
    height_mm = float(height_mm or 0)
    width_allowance = frappe.utils.flt(width_allowance or 0)
    height_allowance = frappe.utils.flt(height_allowance or 0)
    qty = frappe.utils.flt(qty or 1)
    holes = int(holes or 0)
    notches = int(notches or 0)
    polish_width_sides = frappe.utils.cint(polish_width_sides or 0)
    polish_height_sides = frappe.utils.cint(polish_height_sides or 0)
    polishing = int(polishing or 0)
    sandblast_type = sandblast_type or "None"

    # --- Base glass rate (from selected selling price, fallback to hidden retail-backed standard_rate) ---
    item_price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "price_list_rate"
    )
    base_rate = float(item_price or frappe.get_cached_value("Item", item_code, "standard_rate") or 0.0) / 1.16

    breakdown = []
    total = 0.0

    if sale_mode in ("Full Sheet", "Sheet"):
        amount = qty * float(base_rate)
        label = "Glass (Sheet)" if sale_mode == "Sheet" else "Glass (Full Sheet)"
        breakdown.append({"label": label, "qty": qty, "rate": base_rate, "amount": amount})
        total = amount
        return {"total": total, "breakdown": breakdown}

    # --- Dimensions ---
    glass_type = frappe.db.get_value("Item", item_code, "custom_glass_type") or "Ordinary"
    base_width_ft = mm_to_ft(width_mm, glass_type=glass_type) if width_mm else 0.0
    base_height_ft = mm_to_ft(height_mm, glass_type=glass_type) if height_mm else 0.0
    width_ft = base_width_ft + width_allowance
    height_ft = base_height_ft + height_allowance
    area_sqft = width_ft * height_ft
    perimeter_rft = get_polishing_rft(
        mm_to_piece_rft(width_mm),
        mm_to_piece_rft(height_mm),
        qty,
        polish_width_sides,
        polish_height_sides,
        polishing,
    )

    glass_qty = qty * area_sqft
    glass_amount = glass_qty * float(base_rate)
    breakdown.append({"label": "Glass", "qty": round(glass_qty, 4), "rate": base_rate, "amount": glass_amount})
    total += glass_amount

    # --- Service rates: uses global Glass Pricing Settings ---
    try:
        settings = frappe.get_single("Glass Pricing Settings")
    except Exception:
        settings = frappe._dict(polishing_rate=0, hole_rate=0, notch_rate=0, sandblast_rate=0)

    # Polishing
    if not polish_width_sides and not polish_height_sides and polishing:
        polish_width_sides = 2
        polish_height_sides = 2

    if polish_width_sides or polish_height_sides:
        pol_rate = float(settings.polishing_rate or 0) / 1.16
        pol_qty = get_polishing_rft(
            mm_to_piece_rft(width_mm),
            mm_to_piece_rft(height_mm),
            qty,
            polish_width_sides,
            polish_height_sides,
            polishing,
        )
        pol_amount = pol_qty * pol_rate
        breakdown.append({"label": "Polishing", "qty": round(pol_qty, 4), "rate": pol_rate, "amount": pol_amount})
        total += pol_amount

    # Holes
    if holes > 0:
        hole_rate = float(settings.hole_rate or 0) / 1.16
        hole_qty = qty * holes
        hole_amount = hole_qty * hole_rate
        breakdown.append({"label": "Hole Drilling", "qty": hole_qty, "rate": hole_rate, "amount": hole_amount})
        total += hole_amount

    # Notches
    if notches > 0:
        notch_rate = float(getattr(settings, "notch_rate", 0) or 0) / 1.16
        notch_qty = qty * notches
        notch_amount = notch_qty * notch_rate
        breakdown.append({"label": "Notching", "qty": notch_qty, "rate": notch_rate, "amount": notch_amount})
        total += notch_amount

    # Sandblasting
    if sandblast_type in ["Half", "Full"]:
        sb_rate = float(settings.sandblast_rate or 0) / 1.16
        sb_qty = glass_qty / 2.0 if sandblast_type == "Half" else glass_qty
        sb_amount = sb_qty * sb_rate
        breakdown.append({"label": f"Sandblasting ({sandblast_type})", "qty": round(sb_qty, 4), "rate": sb_rate, "amount": sb_amount})
        total += sb_amount

    return {
        "total": total,
        "base_width_ft": base_width_ft,
        "base_height_ft": base_height_ft,
        "area_sqft": area_sqft,
        "perimeter_rft": perimeter_rft,
        "width_ft": width_ft,
        "height_ft": height_ft,
        "base_rate": base_rate,
        "breakdown": breakdown
    }

@frappe.whitelist()
def get_items_with_prices(category):
    """
    Fetches all items in the given category, along with their
    Retail and Wholesale prices.
    """
    storage_category = _get_storage_category(category)
    if storage_category == "Aluminium":
        _ensure_aluminium_pricing_storage()
    filters = {"item_group": storage_category}
    if category in GLASS_CATEGORY_TO_TYPE:
        filters["custom_glass_type"] = GLASS_CATEGORY_TO_TYPE[category]

    item_fields = ["name", "item_code", "item_name", "stock_uom", "standard_rate", "custom_glass_type"]
    if _item_has_field("custom_product_code"):
        item_fields.append("custom_product_code")
    if storage_category == "Aluminium":
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item_fields.append("custom_aluminium_rate_per_kg")
        if _item_has_field("custom_aluminium_weight_per_length"):
            item_fields.append("custom_aluminium_weight_per_length")
    items = frappe.get_all("Item", filters=filters, fields=item_fields)

    # Exclude service items from the glass catalog views.
    if storage_category == "Glass":
        service_keywords = ["Polishing", "Drilling", "Sandblasting", "Hole", "Notching", "Notch"]
        items = [i for i in items if not any(k in (i.item_name or "") for k in service_keywords)]
    
    # Fetch Item Prices for these items
    item_codes = [i.name for i in items]
    if not item_codes:
        return []
        
    prices = frappe.get_all("Item Price",
        filters={"item_code": ("in", item_codes), "price_list": ("in", ["Retail", "Wholesale", "Special"])},
        fields=["item_code", "price_list", "price_list_rate", "name"]
    )
    
    # Map prices to items
    price_map = {}
    for p in prices:
        if p.item_code not in price_map:
            price_map[p.item_code] = {}
        price_map[p.item_code][p.price_list] = {
            "rate": p.price_list_rate,
            "docname": p.name
        }
        
    for item in items:
        item.retail_rate = price_map.get(item.name, {}).get("Retail", {}).get("rate", item.standard_rate or 0)
        item.wholesale_rate = price_map.get(item.name, {}).get("Wholesale", {}).get("rate", 0)
        item.special_rate = price_map.get(item.name, {}).get("Special", {}).get("rate", 0)
        if storage_category == "Aluminium":
            item.aluminium_rate_per_kg = flt(getattr(item, "custom_aluminium_rate_per_kg", 0) or 0)
            item.aluminium_weight_per_length = flt(getattr(item, "custom_aluminium_weight_per_length", 0) or 0)
        
        # If it's a Ceiling item, fetch its Ceiling Configuration
        if category == "Ceiling":
            config = frappe.get_all("Ceiling Configuration", 
                filters={"parent_item": item.name},
                fields=["item_1", "ratio_1", "item_2", "ratio_2", "item_3", "ratio_3", "item_4", "ratio_4"],
                limit=1
            )
            if config:
                item.ceiling_config = config[0]
            else:
                item.ceiling_config = {
                    "item_1": "", "ratio_1": 2.5,
                    "item_2": "", "ratio_2": 2.5,
                    "item_3": "", "ratio_3": 3.0,
                    "item_4": "", "ratio_4": 0.36
                }
        
    return items


@frappe.whitelist()
def get_aluminium_colors():
    _ensure_aluminium_color_doctype()
    return frappe.get_all(
        "Aluminium Color",
        fields=["color_name"],
        order_by="color_name asc",
        pluck="color_name",
    )


@frappe.whitelist()
def save_aluminium_colors(colors):
    _ensure_aluminium_color_doctype()

    colors = json.loads(colors) if isinstance(colors, str) else (colors or [])
    clean_colors = []
    seen = set()
    for color in colors:
        color_name = str(color or "").strip()
        if not color_name:
            continue

        normalized = color_name.lower()
        if normalized in seen:
            continue

        seen.add(normalized)
        clean_colors.append(color_name)

    existing = frappe.get_all("Aluminium Color", fields=["name"])
    for row in existing:
        frappe.delete_doc("Aluminium Color", row.name, ignore_permissions=True, force=1)

    for color_name in clean_colors:
        frappe.get_doc({
            "doctype": "Aluminium Color",
            "color_name": color_name,
        }).insert(ignore_permissions=True)

    frappe.db.commit()
    return clean_colors


def _copy_aluminium_color_between_rows(source_rows, target_rows):
    if not source_rows or not target_rows:
        return

    source_rows = [row for row in source_rows if not getattr(row, "custom_auto_generated", 0)]
    target_rows = [row for row in target_rows if not getattr(row, "custom_auto_generated", 0)]
    if any(getattr(row, "custom_aluminium_color", None) for row in source_rows):
        _ensure_aluminium_color_storage()

    source_by_name = {
        row.name: row for row in source_rows
        if getattr(row, "name", None)
    }

    fallback_index = 0
    for target_row in target_rows:
        source_row = None
        prev_detail = getattr(target_row, "prevdoc_detail_docname", None)
        if prev_detail and prev_detail in source_by_name:
            source_row = source_by_name[prev_detail]
        elif fallback_index < len(source_rows):
            source_row = source_rows[fallback_index]
            fallback_index += 1

        if source_row and hasattr(target_row, "custom_aluminium_color"):
            target_row.custom_aluminium_color = getattr(source_row, "custom_aluminium_color", None)

def _save_item_price(item_code, price_list, rate):
    if rate is None:
        return

    _ensure_price_list_exists(price_list)

    price_name = frappe.db.get_value("Item Price", {
        "item_code": item_code,
        "price_list": price_list
    }, "name")

    if price_name:
        frappe.db.set_value("Item Price", price_name, "price_list_rate", rate)
    else:
        ip = frappe.new_doc("Item Price")
        ip.item_code = item_code
        ip.price_list = price_list
        ip.price_list_rate = rate
        ip.save(ignore_permissions=True)

@frappe.whitelist()
def save_custom_item(data):
    """
    Creates or updates an Item and its associated Item Prices (Retail/Wholesale).
    Payload expects: is_new, category, item_code, item_name, retail_rate, wholesale_rate
    """
    data = json.loads(data) if isinstance(data, str) else data
    
    item_code = (data.get("item_code") or "").strip()
    original_item_code = (data.get("original_item_code") or item_code).strip()
    category = data.get("category")
    storage_category = _get_storage_category(category)
    is_new = data.get("is_new")
    aluminium_rate_per_kg = flt(data.get("aluminium_rate_per_kg", 0))
    aluminium_weight_per_length = flt(data.get("aluminium_weight_per_length", 0))
    retail_rate = data.get("retail_rate", 0)
    wholesale_rate = data.get("wholesale_rate", 0)
    special_rate = data.get("special_rate", 0)
    item_name = (data.get("item_name") or item_code).strip()
    glass_type = _get_glass_type_for_category(category, data.get("glass_type"))
    aluminium_type = _normalize_aluminium_type(
        data.get("aluminium_type"),
        data.get("existing_aluminium_type"),
    ) if storage_category == "Aluminium" else None
    product_code = _get_product_code(category, glass_type=glass_type, aluminium_type=aluminium_type, item_name=item_name)

    if not item_code:
        frappe.throw("Item Code is required.")
    if not item_name:
        frappe.throw("Item Name is required.")
    if storage_category == "Aluminium" and (aluminium_rate_per_kg < 0 or aluminium_weight_per_length < 0):
        frappe.throw("Aluminium rate/kg and weight/length cannot be negative.")

    if storage_category == "Glass":
        _ensure_glass_type_options()
    elif storage_category == "Aluminium":
        _ensure_aluminium_pricing_storage()
        aluminium_prices = _get_aluminium_price_components(aluminium_rate_per_kg, aluminium_weight_per_length)
        retail_rate = aluminium_prices["normal_price"]
        wholesale_rate = aluminium_prices["mill_finished_price"]
        special_rate = aluminium_prices["special_price"]
    
    # Determine UOM based on category
    uom = _get_category_uom(category)

    _ensure_item_group_exists(storage_category)
    _ensure_uom_exists(uom)
        
    if is_new:
        if frappe.db.exists("Item", item_code):
            frappe.throw(f"Item Code {item_code} already exists.")
            
        item = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_name,
            "item_group": storage_category,
            "stock_uom": uom,
            "is_stock_item": 0,
            "standard_rate": retail_rate,
            "custom_glass_type": glass_type if storage_category == "Glass" else None,
        })
        if _item_has_field("custom_aluminium_type"):
            item.custom_aluminium_type = aluminium_type if storage_category == "Aluminium" else None
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item.custom_aluminium_rate_per_kg = aluminium_rate_per_kg if storage_category == "Aluminium" else 0
        if _item_has_field("custom_aluminium_weight_per_length"):
            item.custom_aluminium_weight_per_length = aluminium_weight_per_length if storage_category == "Aluminium" else 0
        if _item_has_field("custom_product_code"):
            item.custom_product_code = product_code
        _ensure_item_has_default_uom(item, uom)
        item.insert(ignore_permissions=True)
    else:
        if item_code != original_item_code:
            if frappe.db.exists("Item", item_code):
                frappe.throw(f"Item Code {item_code} already exists.")
            rename_doc("Item", original_item_code, item_code, force=True, ignore_permissions=True)

        item = frappe.get_doc("Item", item_code)
        item.item_code = item_code
        item.item_name = item_name
        item.item_group = storage_category
        item.stock_uom = uom
        item.standard_rate = retail_rate
        item.custom_glass_type = glass_type if storage_category == "Glass" else None
        if _item_has_field("custom_aluminium_type"):
            item.custom_aluminium_type = aluminium_type if storage_category == "Aluminium" else None
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item.custom_aluminium_rate_per_kg = aluminium_rate_per_kg if storage_category == "Aluminium" else 0
        if _item_has_field("custom_aluminium_weight_per_length"):
            item.custom_aluminium_weight_per_length = aluminium_weight_per_length if storage_category == "Aluminium" else 0
        if _item_has_field("custom_product_code"):
            item.custom_product_code = product_code
        _ensure_item_has_default_uom(item, uom)
        item.save(ignore_permissions=True)
        
    # Save Item Prices
    _save_item_price(item_code, "Retail", retail_rate)
    _save_item_price(item_code, "Wholesale", wholesale_rate)
    _save_item_price(item_code, "Special", special_rate)

    # Save Ceiling Configuration if applicable
    if category == "Ceiling" and "ceiling_config" in data:
        cfg = data["ceiling_config"]
        cfg_name = _get_single_config_docname("Ceiling Configuration", item_code, original_item_code)
        if cfg_name:
            doc = frappe.get_doc("Ceiling Configuration", cfg_name)
            doc.parent_item = item_code
            doc.item_1 = cfg.get("item_1")
            doc.ratio_1 = cfg.get("ratio_1", 2.5)
            doc.item_2 = cfg.get("item_2")
            doc.ratio_2 = cfg.get("ratio_2", 2.5)
            doc.item_3 = cfg.get("item_3")
            doc.ratio_3 = cfg.get("ratio_3", 3.0)
            doc.item_4 = cfg.get("item_4")
            doc.ratio_4 = cfg.get("ratio_4", 0.36)
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc({
                "doctype": "Ceiling Configuration",
                "parent_item": item_code,
                "item_1": cfg.get("item_1"), "ratio_1": cfg.get("ratio_1", 2.5),
                "item_2": cfg.get("item_2"), "ratio_2": cfg.get("ratio_2", 2.5),
                "item_3": cfg.get("item_3"), "ratio_3": cfg.get("ratio_3", 3.0),
                "item_4": cfg.get("item_4"), "ratio_4": cfg.get("ratio_4", 0.36)
            })
            doc.insert(ignore_permissions=True)
    
    return item.name


@frappe.whitelist()
def download_glass_builder_template():
    headers = [[
        "width",
        "height",
        "w+",
        "h+",
        "pcs",
        "holes",
        "notches",
        "sandblast",
        "polish_width_side",
        "polish_height_side",
        "numbering",
        "details",
    ]]
    sample = [[
        600,
        900,
        0,
        0,
        1,
        2,
        0,
        0.5,
        2,
        2,
        1,
        "",
    ], [
        1200,
        900,
        0.25,
        0.25,
        2,
        1,
        1,
        1,
        2,
        1,
        2,
        "Office partition",
    ]]
    return _build_xlsx_file("glass_builder_template", headers + sample)


@frappe.whitelist()
def export_glass_items_from_builder(items):
    items = json.loads(items) if isinstance(items, str) else (items or [])
    rows = [[
        "width",
        "height",
        "w+",
        "h+",
        "pcs",
        "holes",
        "notches",
        "sandblast",
        "polish_width_side",
        "polish_height_side",
        "numbering",
        "details",
    ]]

    for idx, item in enumerate(items):
        if item.get("category") != "Glass":
            continue
        rows.append([
            item.get("width_mm", 0),
            item.get("height_mm", 0),
            item.get("width_allowance", 0),
            item.get("height_allowance", 0),
            item.get("qty", 0),
            item.get("holes", 0),
            item.get("notches", 0),
            1 if item.get("sandblast_type") == "Full" else 0.5 if item.get("sandblast_type") == "Half" else 0,
            item.get("polish_width_sides", 0),
            item.get("polish_height_sides", 0),
            idx + 1,
            item.get("description", ""),
        ])

    return _build_xlsx_file("glass_builder_export", rows)


@frappe.whitelist()
def export_quotation_builder_items(data):
    data = json.loads(data) if isinstance(data, str) else (data or [])
    return _build_xlsx_file("Quotation_Export", data)


@frappe.whitelist()
def download_aluminium_items_template():
    rows = [[
        "item_name",
        "code",
        "rate_per_kg",
        "weight_per_length",
    ], [
        "Sample Aluminium Item",
        "A01.1",
        870,
        3.6,
    ]]
    return _build_xlsx_file("aluminium_items_template", rows)


def _normalize_glass_dimension_uom(dimension_uom=None):
    return "inches" if (dimension_uom or "").strip().lower() == "inches" else "mm"


def _dimension_to_mm(value, dimension_uom=None):
    value = frappe.utils.flt(value or 0)
    return value * 25.4 if _normalize_glass_dimension_uom(dimension_uom) == "inches" else value


@frappe.whitelist()
def import_glass_items_to_builder(file_url, glass_type=None, item_code=None, price_list=None, dimension_uom=None):
    if not file_url:
        frappe.throw("Please attach an Excel file.")

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    extension = (file_doc.file_name or file_url).rsplit(".", 1)[-1].lower()
    if extension not in ("xlsx", "xls"):
        frappe.throw("Please upload an .xlsx or .xls file.")

    from frappe.utils.xlsxutils import read_xls_file_from_attached_file, read_xlsx_file_from_attached_file
    from crystal_alluminium_works.pricing_engine import calculate_dimensions

    rows = (
        read_xlsx_file_from_attached_file(file_url=file_url)
        if extension == "xlsx"
        else read_xls_file_from_attached_file(file_doc.get_content())
    )
    rows = [row for row in (rows or []) if not _is_empty_import_row(row)]
    if len(rows) < 2:
        frappe.throw("The uploaded file must include a header row and at least one item row.")

    glass_type = (glass_type or "").strip()
    item_code = (item_code or "").strip()
    price_list = (price_list or "").strip()
    dimension_uom = _normalize_glass_dimension_uom(dimension_uom)
    if glass_type not in GLASS_TYPE_OPTIONS:
        frappe.throw("Please select a valid glass category.")
    if not item_code:
        frappe.throw("Please select the glass item to import.")
    if price_list not in PRICE_TYPE_TO_PRICE_LIST.values():
        frappe.throw("Please select a valid selling price.")

    headers = [_normalize_builder_sheet_header(cell) for cell in rows[0]]
    aliases = {
        "numbering": "numbering",
        "width": "width",
        "height": "height",
        "w+": "width_allowance",
        "h+": "height_allowance",
        "width_allowance": "width_allowance",
        "height_allowance": "height_allowance",
        "pcs": "pcs",
        "holes": "holes",
        "notches": "notches",
        "sandblast": "sandblast",
        "sand_blast": "sandblast",
        "polish_width_side": "polish_width_side",
        "polish_height_side": "polish_height_side",
        "details": "details",
        "description": "details",
    }
    normalized_headers = {aliases.get(header, header): idx for idx, header in enumerate(headers)}
    required_headers = {"width", "height", "pcs", "holes", "notches", "polish_width_side", "polish_height_side", "numbering"}
    missing_headers = required_headers - set(normalized_headers)
    if missing_headers:
        frappe.throw(f"Missing required column(s): {', '.join(sorted(missing_headers))}")

    product_code = GLASS_TYPE_TO_PRODUCT_CODE.get(glass_type)
    if not product_code:
        frappe.throw("Could not resolve the selected glass category to a product code.")

    item_doc = _get_builder_item_by_item_code(item_code, product_code, ["Glass"])
    item_glass_type = item_doc.custom_glass_type or "Ordinary"
    if item_glass_type != glass_type:
        frappe.throw("The selected glass item does not match the chosen glass category.")

    imported_items = []
    for row_number, row in enumerate(rows[1:], start=2):
        width_value = frappe.utils.flt(_get_import_cell(row, normalized_headers["width"]) or 0)
        height_value = frappe.utils.flt(_get_import_cell(row, normalized_headers["height"]) or 0)
        width_mm = _dimension_to_mm(width_value, dimension_uom)
        height_mm = _dimension_to_mm(height_value, dimension_uom)
        width_allowance = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("width_allowance", -1)) or 0)
        height_allowance = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("height_allowance", -1)) or 0)
        qty = frappe.utils.cint(_get_import_cell(row, normalized_headers["pcs"]) or 0)
        holes = frappe.utils.cint(_get_import_cell(row, normalized_headers["holes"]) or 0)
        notches = frappe.utils.cint(_get_import_cell(row, normalized_headers["notches"]) or 0)
        sandblast_value = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("sandblast", -1)) or 0)
        polish_width_sides = frappe.utils.cint(_get_import_cell(row, normalized_headers["polish_width_side"]) or 0)
        polish_height_sides = frappe.utils.cint(_get_import_cell(row, normalized_headers["polish_height_side"]) or 0)
        numbering = _clean_import_text(_get_import_cell(row, normalized_headers["numbering"]))
        details = _clean_import_text(_get_import_cell(row, normalized_headers.get("details", -1)))

        sandblast_map = {
            0.0: "None",
            0.5: "Half",
            1.0: "Full",
        }
        sandblast_type = sandblast_map.get(round(sandblast_value, 2))

        if polish_width_sides not in (0, 1, 2) or polish_height_sides not in (0, 1, 2):
            frappe.throw(f"Row {row_number}: polish side values can only be 0, 1, or 2.")
        if holes < 0 or notches < 0:
            frappe.throw(f"Row {row_number}: holes and notches cannot be negative.")
        if width_allowance < 0 or height_allowance < 0:
            frappe.throw(f"Row {row_number}: W+ and H+ cannot be negative.")
        if sandblast_type is None:
            frappe.throw(f"Row {row_number}: sandblast must be 0, 0.5, 1, or empty.")
        if width_mm <= 0 or height_mm <= 0 or qty <= 0:
            frappe.throw(f"Row {row_number}: glass rows require width, height, and Pcs greater than zero.")

        dim = calculate_dimensions(width_mm, height_mm, glass_type=item_glass_type, item_code=item_doc.item_code)
        total = calculate_glass_total(
            item_code=item_doc.item_code,
            price_list=price_list,
            qty=qty,
            sale_mode="Resized",
            width_mm=width_mm,
            height_mm=height_mm,
            polish_width_sides=polish_width_sides,
            polish_height_sides=polish_height_sides,
            holes=holes,
            notches=notches,
            sandblast_type=sandblast_type,
            width_allowance=width_allowance,
            height_allowance=height_allowance,
        )

        imported_items.append({
            "id": frappe.generate_hash(length=8),
            "category": "Glass",
            "item_code": item_doc.item_code,
            "item_name": item_doc.item_name,
            "uom": item_doc.stock_uom or "Square Foot",
            "description": details,
            "numbering": numbering,
            "product_code": product_code,
            "price_list": price_list,
            "qty": qty,
            "rate": total.get("base_rate", 0),
            "amount": total.get("total", 0),
            "dimension_uom": dimension_uom,
            "sale_mode": "Resized",
            "width_mm": width_mm,
            "height_mm": height_mm,
            "width_allowance": width_allowance,
            "height_allowance": height_allowance,
            "base_width_ft": total.get("base_width_ft", dim.get("width_ft", 0)),
            "base_height_ft": total.get("base_height_ft", dim.get("height_ft", 0)),
            "width_ft": total.get("width_ft", dim.get("width_ft", 0)),
            "height_ft": total.get("height_ft", dim.get("height_ft", 0)),
            "area_sqft": total.get("area_sqft", dim.get("area_sqft", 0)),
            "perimeter_rft": total.get("perimeter_rft", dim.get("perimeter_rft", 0)),
            "polishing": 1 if polish_width_sides or polish_height_sides else 0,
            "polish_width_sides": polish_width_sides,
            "polish_height_sides": polish_height_sides,
            "holes": holes,
            "notches": notches,
            "sandblast_type": sandblast_type,
            "glass_type": item_glass_type,
            "glass_breakdown": total.get("breakdown", []),
        })

    return {"items": imported_items}


@frappe.whitelist()
def get_dimension_intervals(interval_set=None):
    interval_set = interval_set or STANDARD_GLASS_INTERVAL_SET
    fields = ["name", "min_mm", "max_mm", "equivalent_ft", "equivalent_inches", "interval_set"]

    if _dimension_range_has_field("equivalent_inches_min"):
        fields.append("equivalent_inches_min")
    if _dimension_range_has_field("equivalent_inches_max"):
        fields.append("equivalent_inches_max")

    intervals = frappe.get_all("Dimension Range", 
        filters={"interval_set": interval_set},
        fields=fields,
        order_by="min_mm asc"
    )
    return intervals

@frappe.whitelist()
def save_dimension_intervals(intervals, interval_set=None):
    intervals = json.loads(intervals) if isinstance(intervals, str) else intervals
    interval_set = interval_set or STANDARD_GLASS_INTERVAL_SET
    has_inches_min = _dimension_range_has_field("equivalent_inches_min")
    has_inches_max = _dimension_range_has_field("equivalent_inches_max")
    
    # Clear existing only for the selected set
    existing = frappe.get_all("Dimension Range", filters={"interval_set": interval_set}, pluck="name")
    for name in existing:
        frappe.delete_doc("Dimension Range", name, ignore_permissions=True)
        
    # Insert new
    for i in intervals:
        doc_data = {
            "doctype": "Dimension Range",
            "min_mm": float(i.get("min_mm", 0)),
            "max_mm": float(i.get("max_mm", 0)),
            "equivalent_ft": float(i.get("equivalent_ft", 0)),
            "equivalent_inches": float(i.get("equivalent_inches_max") or i.get("equivalent_inches") or 0),
            "interval_set": interval_set,
        }

        if has_inches_min:
            doc_data["equivalent_inches_min"] = float(i.get("equivalent_inches_min", 0))
        if has_inches_max:
            doc_data["equivalent_inches_max"] = float(i.get("equivalent_inches_max") or i.get("equivalent_inches") or 0)

        doc = frappe.get_doc(doc_data)
        doc.insert(ignore_permissions=True)
        
    return True


@frappe.whitelist()
def get_glass_sheet_configs(glass_type=None):
    _ensure_glass_sheet_config_storage()
    glass_type = _normalize_glass_sheet_type(glass_type or "Ordinary")
    return frappe.get_all(
        "Glass Sheet Config",
        filters={"glass_type": glass_type},
        fields=["size", "sft"],
        order_by="creation asc",
    )


@frappe.whitelist()
def save_glass_sheet_configs(rows, glass_type=None):
    _ensure_glass_sheet_config_storage()
    glass_type = _normalize_glass_sheet_type(glass_type or "Ordinary")
    rows = json.loads(rows) if isinstance(rows, str) else (rows or [])

    existing = frappe.get_all("Glass Sheet Config", filters={"glass_type": glass_type}, pluck="name")
    for name in existing:
        frappe.delete_doc("Glass Sheet Config", name, ignore_permissions=True, force=1)

    for row in rows:
        size = str((row or {}).get("size") or "").strip()
        sft = flt((row or {}).get("sft") or 0)
        if not size or sft <= 0:
            continue

        frappe.get_doc({
            "doctype": "Glass Sheet Config",
            "glass_type": glass_type,
            "size": size,
            "sft": sft,
        }).insert(ignore_permissions=True)

    frappe.db.commit()
    return True

@frappe.whitelist()
def import_category_items(file_url, category):
    """
    Import items from an Excel file for a specific category.
    Expected headers for Aluminium: item_name, code, rate_per_kg, weight_per_length
    Expected headers for other categories: description, code, wholesale_rate, retail_rate, special_rate
    Legacy optional column for Aluminium: aluminium_type (ignored)
    """
    if not file_url:
        frappe.throw("Please attach an Excel file.")

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    extension = (file_doc.file_name or file_url).rsplit(".", 1)[-1].lower()

    if extension not in ("xlsx", "xls"):
        frappe.throw("Please upload an .xlsx or .xls file.")

    from frappe.utils.xlsxutils import (
        read_xls_file_from_attached_file,
        read_xlsx_file_from_attached_file,
    )

    if extension == "xlsx":
        rows = read_xlsx_file_from_attached_file(file_url=file_url)
    else:
        rows = read_xls_file_from_attached_file(file_doc.get_content())

    rows = rows or []
    rows = [row for row in rows if not _is_empty_import_row(row)]
    if len(rows) < 2:
        frappe.throw("The uploaded file must include a header row and at least one item row.")

    headers = [_normalize_import_header(cell) for cell in rows[0]]
    is_aluminium = _get_storage_category(category) == "Aluminium"
    required_headers = (
        {"item_name", "code", "rate_per_kg", "weight_per_length"}
        if is_aluminium else
        {"description", "code", "wholesale_rate", "retail_rate", "special_rate"}
    )

    missing_headers = required_headers - set(headers)
    if missing_headers:
        frappe.throw(f"Missing required column(s): {', '.join(sorted(missing_headers))}")

    column_index = {header: headers.index(header) for header in required_headers}
    created = 0
    updated = 0
    skipped = 0
    errors = []

    for row_number, row in enumerate(rows[1:], start=2):
        item_name = _clean_import_text(
            _get_import_cell(row, column_index["item_name" if is_aluminium else "description"])
        )
        code = _clean_import_text(_get_import_cell(row, column_index["code"]))
        if not item_name or not code:
            skipped += 1
            errors.append(f"Row {row_number}: item name and code are required.")
            continue

        exists = frappe.db.exists("Item", code)
        if exists:
            existing_group = frappe.db.get_value("Item", code, "item_group")
            storage_category = _get_storage_category(category)
            if existing_group != storage_category:
                skipped += 1
                errors.append(
                    f"Row {row_number}: code {code} already exists in item group {existing_group}."
                )
                continue
        payload = {
            "is_new": not exists,
            "category": category,
            "item_code": code,
            "original_item_code": code,
            "item_name": item_name,
        }

        if is_aluminium:
            rate_per_kg = frappe.utils.flt(_get_import_cell(row, column_index["rate_per_kg"]) or 0)
            weight_per_length = frappe.utils.flt(_get_import_cell(row, column_index["weight_per_length"]) or 0)

            if rate_per_kg < 0 or weight_per_length < 0:
                skipped += 1
                errors.append(f"Row {row_number}: rate_per_kg and weight_per_length cannot be negative.")
                continue

            payload["aluminium_rate_per_kg"] = rate_per_kg
            payload["aluminium_weight_per_length"] = weight_per_length
        else:
            wholesale_rate = frappe.utils.flt(_get_import_cell(row, column_index["wholesale_rate"]) or 0)
            retail_rate = frappe.utils.flt(_get_import_cell(row, column_index["retail_rate"]) or 0)
            special_rate = frappe.utils.flt(_get_import_cell(row, column_index["special_rate"]) or 0)

            if wholesale_rate < 0 or retail_rate < 0 or special_rate < 0:
                skipped += 1
                errors.append(f"Row {row_number}: rates cannot be negative.")
                continue

            payload["retail_rate"] = retail_rate
            payload["wholesale_rate"] = wholesale_rate
            payload["special_rate"] = special_rate

        save_custom_item(payload)

        if exists:
            updated += 1
        else:
            created += 1

    frappe.db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }

@frappe.whitelist()
def delete_items(item_codes):
	import json
	if isinstance(item_codes, str):
		item_codes = json.loads(item_codes)
	deleted = 0
	service_item_codes = set(GLASS_SERVICE_ITEM_DEFS)
	for item_code in item_codes:
		if item_code in service_item_codes:
			continue
		if frappe.db.exists("Item", item_code):
			frappe.delete_doc("Item", item_code)
			deleted += 1
	return deleted

@frappe.whitelist()
def get_all_glass_items():
    items = frappe.get_all("Item", filters={"item_group": "Glass"}, fields=["name", "item_code", "item_name", "stock_uom"])
    service_keywords = ["Polishing", "Drilling", "Sandblasting", "Hole", "Notching", "Notch"]
    return [i for i in items if not any(k in (i.item_name or "") for k in service_keywords)]
