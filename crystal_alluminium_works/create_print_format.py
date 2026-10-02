import base64

import frappe
from crystal_alluminium_works.print_format_config import (
    get_print_format_context,
    ensure_default_print_format_configurations,
)

# The letterhead is embedded directly as a base64 data URI rather than linked via
# its /assets/ URL. The static URL renders in the PDF and when opened directly, but
# breaks in the desk print preview (the image is requested from a context where the
# root-relative URL does not resolve back to the site origin). A data URI carries the
# image inline, so it renders identically in the preview, PDF, and full-page views
# with no dependency on asset serving or browser caching.
LETTERHEAD_ASSET_PATH = "/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg"

_LETTERHEAD_DATA_URI = None


def get_letterhead_data_uri():
    global _LETTERHEAD_DATA_URI
    if _LETTERHEAD_DATA_URI is None:
        image_path = frappe.get_app_path(
            "crystal_alluminium_works",
            "public",
            "images",
            "crystal-alluminium-works-letterhead.jpeg",
        )
        with open(image_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode()
        _LETTERHEAD_DATA_URI = f"data:image/jpeg;base64,{encoded}"
    return _LETTERHEAD_DATA_URI


def embed_letterhead_image(html):
    return html.replace(LETTERHEAD_ASSET_PATH, get_letterhead_data_uri())


# The UOM printed on Quotation / Sales Invoice / Credit Note / Sales Order rows, in place of
# the stock UOM (aluminium is stocked in Nos but sold by the length). Print-only — the
# documents' own uom and stock postings are untouched. An item code listed here wins over
# its category.
PRINT_UOM_BY_CATEGORY = {
    "Aluminium": "Length",
    "Silicone": "pcs",
}
PRINT_UOM_BY_ITEM_CODE = {
    **dict.fromkeys(
        ["F09", "F10", "F10.1", "F10.2", "F10.3", "F10.4", "F68.0", "F68.1", "F68.2",
         "F68.2.0", "F68.2.1", "F68.2.2", "F68.3", "F68.3.1",
         # Friction arms
         "F32", "F33", "F34", "F35", "F36", "F37", "F37.1", "F38",
         # Door and booth hinges (shower hinges stay per piece)
         "F23", "F23.1", "F23.2", "F23.3", "F24", "F24.1", "F25", "F25.1"],
        "Pair(s)",
    ),
    **dict.fromkeys(
        ["F48", "F48.1", "F49", "F50", "F50.1", "F50.2", "F51", "F52", "F53", "F54", "F55",
         "F55.1", "F60", "F666"],
        "Boxes",
    ),
    **dict.fromkeys(["F77", "F77.1"], "Buckets"),
    **dict.fromkeys(["F83", "F99.1"], "Metres"),
    **dict.fromkeys(["F91", "F92"], "Sqm"),
}

# Frappe gives a PDF with no separate header a 15mm top page margin, which left a blank band
# above the letterhead. get_pdf reads margin overrides from a `.print-format { ... }` rule in the
# page itself (read_options_from_html), so every Crystal template starts with this to pull the
# letterhead up to the top of the page. The side margins drop from Frappe's 15mm to 8mm so the
# item tables have room for every column (a wide font such as DejaVu Sans otherwise pushed the
# Amount column off the page).
CRYSTAL_PAGE_STYLE = "<style>.print-format { margin-top: 5mm; margin-left: 8mm; margin-right: 8mm; }</style>\n"


def build_crystal_print_format_html(ref_label, terms, payment_details=""):
    html = f"""
{{% macro short_uom(value) %}}
    {{% set normalized = (value or '')|trim|lower %}}
    {{% if normalized == 'square foot' %}}sft
    {{% elif normalized == 'square meter' %}}sqm
    {{% elif normalized in ['meter', 'metre', 'len'] %}}len
    {{% elif normalized in ['running foot', 'rft'] %}}rft
    {{% elif normalized == 'nos' %}}nos
    {{% else %}}{{{{ value or '-' }}}}{{% endif %}}
{{% endmacro %}}

{{% set print_uom_by_category = {PRINT_UOM_BY_CATEGORY!r} %}}
{{% set print_uom_by_item_code = {PRINT_UOM_BY_ITEM_CODE!r} %}}
{{% macro print_uom(row, uom) %}}
    {{{{ print_uom_by_item_code.get(row.item_code) or print_uom_by_category.get(row.custom_product_category or '') or short_uom(uom) }}}}
{{% endmacro %}}

{{% macro format_dimension(mm_value, uom) %}}
    {{% if not (mm_value or 0) %}}-
    {{% elif (uom or '')|lower == 'inches' %}}{{{{ frappe.utils.flt(mm_value / 25.4, 2) }}}}"
    {{% else %}}{{{{ '%.0f'|format(mm_value or 0) }}}}mm{{% endif %}}
{{% endmacro %}}

<div class="letterhead" style="margin-bottom: 20px;">
    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="display: block; width: 100%; height: auto;" alt="Crystal Aluminium Works">
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">
<div class="row" style="margin-bottom: 10px;">
    <div class="col-xs-8">
        <!-- Cash quotations all share the one walk-in Customer record, so customer_name/
             party_name is always "Cash Customer" - custom_customer_name (Quotation only,
             captured in Quotation Builder's cash-mode step) carries the walk-in's own name. -->
        <div style="font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            Customer Name: {{{{ doc.get('custom_customer_name') or doc.customer_name or doc.party_name or doc.customer }}}}
        </div>
        <!-- Walk-ins carry their own PIN on the Quotation (custom_customer_pin); a registered
             customer's is mirrored onto the document from Customer.tax_id - natively as
             `tax_id` on Sales Order/Invoice, via custom_customer_tax_id on Quotation. Read
             from the doc only: frappe.db.get_value is not callable from a print template
             unless an HTTP request is in scope, which breaks server-side PDF rendering.
             Shows "-" when the customer has no PIN. -->
        {{% set customer_pin = doc.get('custom_customer_pin') or doc.get('custom_customer_tax_id') or doc.get('tax_id') %}}
        <div style="margin-top: 6px; font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            PIN Number: {{{{ customer_pin or '-' }}}}
        </div>
    </div>
    <div class="col-xs-4 text-right">
        <div style="font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            Date: {{{{ frappe.utils.formatdate(doc.posting_date or doc.transaction_date) }}}}
        </div>
        {{% if doc.doctype != 'Sales Invoice' and doc.due_date %}}
        <div style="font-size: 14px; font-weight: bold; color: #e74c3c; text-transform: uppercase; margin-top: 5px; white-space: nowrap;">
            Due Date: {{{{ frappe.utils.formatdate(doc.due_date) }}}}
        </div>
        {{% endif %}}
        {{# A cash customer's invoice prints as a Cash Sale, with a Sale No (billing type, as in
           api.is_cash_customer). Credit notes and invoice customers are unchanged. #}}
        {{% set is_cash_sale = doc.doctype == 'Sales Invoice' and not doc.get('is_return') and frappe.call('crystal_alluminium_works.api.is_cash_customer', customer=doc.customer) %}}
        {{% if doc.doctype == 'Quotation' %}}
        {{% set quote_name_parts = doc.name.split('-') %}}
        <div style="margin-top: 10px; font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            Quote No: {{{{ quote_name_parts[3 if quote_name_parts[0] == 'SAL' else 2]|int }}}}
        </div>
        {{% elif doc.doctype == 'Sales Invoice' and not doc.get('is_return') %}}
        <!-- Same bold one-line style as the Quotation's Quote No. -->
        <div style="margin-top: 10px; font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            {{{{ 'Sale No' if is_cash_sale else 'Invoice No' }}}}: {{{{ doc.name }}}}
        </div>
        {{% else %}}
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 10px;">{ref_label}:</div>
        <div style="font-size: 14px;">{{{{ doc.name }}}}</div>
        {{% if doc.get('is_return') and doc.get('return_against') %}}
        <!-- A credit note names the invoice it reverses. -->
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 8px;">Against Invoice:</div>
        <div style="font-size: 14px;">{{{{ doc.return_against }}}}</div>
        {{% if doc.get('custom_cu_invoice_no') %}}
        <!-- The original invoice's KRA CU number, which TIMS needs to accept the credit note. -->
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 8px;">CU INV NO:</div>
        <div style="font-size: 14px;">{{{{ doc.custom_cu_invoice_no }}}}</div>
        {{% endif %}}
        {{% endif %}}
        {{% endif %}}
    </div>
</div>
{{% if doc.doctype in ('Sales Invoice', 'Quotation') %}}
<div class="text-center" style="margin-bottom: 20px; font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px;">
    {{{{ ('Credit Note' if doc.get('is_return') else ('Cash Sale' if is_cash_sale else 'Invoice')) if doc.doctype == 'Sales Invoice' else 'Quotation' }}}}
</div>
{{% else %}}
<div style="margin-bottom: 20px;"></div>
{{% endif %}}

<style>
    .cq-table {{
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }}
    .cq-table th {{
        background-color: #f8f9fa;
        color: #2c3e50;
        border-bottom: 2px solid #dee2e6;
        /* 12px still fits a glass table with every column filled (polish, holes and notches with
           charges) in DejaVu Sans, the font staging renders in — see the padding rule below. */
        font-size: 12px;
        vertical-align: bottom;
        /* Headers wrap ("Polish Sides" over two lines) so they never set the table wider than the page. */
        white-space: normal !important;
    }}
    .cq-table td {{
        border-bottom: 1px solid #dee2e6;
        vertical-align: middle;
        font-size: 12px;
    }}
    /* Frappe's print stylesheet forces "padding: 6px !important" on every print-format cell; half
       that on the sides keeps the columns tight enough for 12px text. */
    .print-format .cq-table th,
    .print-format .cq-table td {{
        padding: 5px 3px !important;
    }}
    .print-format .cq-table .cq-uom {{
        /* UOM is centred right after the right-aligned Rate; keep the two apart. */
        padding-left: 8px !important;
    }}
    .cq-item-glass {{
        /* Keeps the glass table's fixed-width columns from squeezing Item to a word per line. */
        min-width: 60px;
    }}
    /* Quotation / Sales Invoice item tables print at 14px: one table per section, and the Glass
       one without Polish Sides / Holes / Notches, so they have room for it. */
    .cq-table.cq-table-lg th,
    .cq-table.cq-table-lg td {{
        font-size: 14px;
    }}
    .cq-child-table {{
        width: 100%;
        border-collapse: collapse;
        background-color: #fdfdfd;
    }}
    .cq-child-table td {{
        padding: 6px 10px;
        border-bottom: 1px solid #f1f3f5;
        font-size: 12px;
        color: #6c757d;
    }}
    .cq-child-table tr:last-child td {{
        border-bottom: none;
    }}
</style>

{{% set has_ceiling_parent = namespace(value=false) %}}
{{% set has_ceiling_bundle = namespace(value=false) %}}
{{% set ceiling_single_labels = namespace(items=[]) %}}
{{% set ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'] %}}
{{% set ceiling_board_item_codes = frappe.call("crystal_alluminium_works.api.get_ceiling_board_item_codes") %}}
{{% for row in doc.items %}}
    {{% if not row.custom_auto_generated %}}
        {{% set row_category = row.custom_product_category or '' %}}
        {{% if row_category == 'Ceiling' %}}
            {{% set has_ceiling_parent.value = true %}}
            {{% if frappe.utils.flt(row.custom_ceiling_sq_m or 0) > 0 %}}
                {{% set has_ceiling_bundle.value = true %}}
            {{% else %}}
                {{% set single_label = 'Board' if row.item_code in ceiling_board_item_codes else (row.item_name or row.item_code or '') %}}
                {{% if single_label and single_label not in ceiling_single_labels.items %}}
                    {{% set ceiling_single_labels.items = ceiling_single_labels.items + [single_label] %}}
                {{% endif %}}
            {{% endif %}}
        {{% endif %}}
    {{% endif %}}
{{% endfor %}}

{{# Quotations and Sales Invoices (credit notes included) print their items in the same
   sections as the Quotation Manager / Builder review (Glass, Aluminium, Fittings, Rubber,
   Silicone, Ceiling, then anything else), each with only the columns it uses and its own
   subtotal. A Sales Order keeps one combined table ('All') followed by Ceiling. #}}
{{% set item_section_names = ['Glass', 'Aluminium', 'Fittings', 'Rubber', 'Silicone', 'Ceiling'] %}}
{{% set sectioned_items = doc.doctype in ['Quotation', 'Sales Invoice'] %}}
{{% set item_sections = item_section_names + ['Other'] if sectioned_items else ['All', 'Ceiling'] %}}
{{% for section in item_sections %}}
{{% if section == 'Ceiling' %}}
{{% if has_ceiling_parent.value %}}
{{% set ceiling_columns = ceiling_component_labels if has_ceiling_bundle.value else ceiling_single_labels.items %}}
<div style="margin: 10px 0 8px 0; font-size: 13px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">Ceiling Items</div>
<table class="cq-table{{{{ ' cq-table-lg' if sectioned_items else '' }}}}">
    <thead>
        <tr>
            <th style="text-align: center; white-space: nowrap;">No</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {{% if has_ceiling_bundle.value %}}
            <th style="text-align: center; white-space: nowrap;">Quantity</th>
            {{% endif %}}
            <th style="text-align: center; white-space: nowrap;">UOM</th>
            {{% for column in ceiling_columns %}}
            <th style="text-align: center; white-space: nowrap;">{{{{ column }}}}</th>
            {{% endfor %}}
            <th style="text-align: right; white-space: nowrap;">Rate</th>
            <th style="text-align: right; white-space: nowrap;">Amount</th>
        </tr>
    </thead>
    <tbody>
        {{% set ceiling_total = namespace(amount=0) %}}
        {{% for parent in doc.items %}}
            {{% if not parent.custom_auto_generated and (parent.custom_product_category or '') == 'Ceiling' %}}
                {{% set is_bundle = frappe.utils.flt(parent.custom_ceiling_sq_m or 0) > 0 %}}
                {{% set ceiling_quantity = parent.custom_ceiling_sq_m or 0 %}}
                {{% set item_label = 'Board' if parent.item_code in ceiling_board_item_codes else (parent.item_name or parent.item_code or '') %}}
                {{% set display_uom = parent.uom or 'Nos' %}}
                {{% if is_bundle or parent.item_code in ceiling_board_item_codes %}}
                    {{% set display_uom = parent.uom or 'Square Meter' %}}
                {{% endif %}}
                {{% set child_rows = namespace(items=[]) %}}
                {{% for child in doc.items %}}
                    {{% if child.custom_auto_generated and child.custom_parent_row_idx == parent.idx %}}
                        {{% set child_rows.items = child_rows.items + [child] %}}
                    {{% endif %}}
                {{% endfor %}}
                {{% set line = namespace(amount=parent.amount or 0) %}}
                {{% for child in child_rows.items %}}
                    {{% set line.amount = line.amount + (child.amount or 0) %}}
                {{% endfor %}}
                {{% set ceiling_total.amount = ceiling_total.amount + line.amount %}}
                {{% set display_rate = parent.rate or 0 %}}
                {{% if is_bundle and frappe.utils.flt(ceiling_quantity or 0) > 0 %}}
                    {{% set display_rate = (parent.rate or 0) / frappe.utils.flt(ceiling_quantity or 0) %}}
                {{% endif %}}
                <tr>
                    <td style="text-align: center; white-space: nowrap;">{{{{ parent.idx or '-' }}}}</td>
                    <td>{{{{ parent.item_name or parent.item_code or '' }}}}</td>
                    {{% if has_ceiling_bundle.value %}}
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if is_bundle %}}{{{{ frappe.utils.flt(ceiling_quantity, 3) }}}}{{% else %}}-{{% endif %}}
                    </td>
                    {{% endif %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ short_uom(display_uom) }}}}</td>
                    {{% for column in ceiling_columns %}}
                        {{% set column_qty = namespace(value='-') %}}
                        {{% if is_bundle %}}
                            {{% if column == 'Board' %}}
                                {{% set column_qty.value = frappe.utils.cint((ceiling_quantity or 0) / 0.36) %}}
                            {{% else %}}
                                {{% for child in child_rows.items %}}
                                    {{% if (child.item_code or child.item_name or '') == column %}}
                                        {{% set column_qty.value = frappe.utils.flt(child.qty or 0, 0) %}}
                                    {{% endif %}}
                                {{% endfor %}}
                            {{% endif %}}
                        {{% elif item_label == column %}}
                            {{% set column_qty.value = frappe.utils.flt(parent.qty or 0, 0) %}}
                        {{% endif %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ column_qty.value }}}}</td>
                    {{% endfor %}}
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(display_rate, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(line.amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                </tr>
            {{% endif %}}
        {{% endfor %}}
        {{% if sectioned_items %}}
        <tr>
            <td colspan="{{{{ 4 + (1 if has_ceiling_bundle.value else 0) + ceiling_columns|length }}}}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: right; white-space: nowrap; font-weight: bold;">{{{{ frappe.format_value(ceiling_total.amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
        </tr>
        {{% endif %}}
    </tbody>
</table>
{{% endif %}}
{{% else %}}
{{% set section_rows = namespace(items=[], color=false, glass=false, non_aluminium=false, amount=0) %}}
{{% for row in doc.items %}}
    {{% set row_category = row.custom_product_category or '' %}}
    {{% if not row.custom_auto_generated and row_category != 'Ceiling' and (section == 'All' or row_category == section or (section == 'Other' and row_category not in item_section_names)) %}}
        {{% set section_rows.items = section_rows.items + [row] %}}
        {{% if (row.custom_aluminium_color or '')|trim %}}{{% set section_rows.color = true %}}{{% endif %}}
        {{% if row_category == 'Glass' %}}{{% set section_rows.glass = true %}}{{% endif %}}
        {{% if row_category != 'Aluminium' %}}{{% set section_rows.non_aluminium = true %}}{{% endif %}}
    {{% endif %}}
{{% endfor %}}
{{% if section_rows.items %}}
{{# Sales Invoices print glass in its own section without the Polish Sides / Holes / Notches
   columns (their charges are still in the row's Amount). Quotations keep them, headed PS / HL /
   NT to fit the 14px table, as does the combined table Sales Orders print. #}}
{{% set show_glass_services = section_rows.glass and (not sectioned_items or doc.doctype == 'Quotation') %}}
{{% set short_glass_service_headers = doc.doctype == 'Quotation' %}}
{{% set large_glass_table = section_rows.glass and sectioned_items %}}
{{% if section != 'All' %}}
<div style="margin: 10px 0 8px 0; font-size: 13px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">{{{{ section }}}} Items</div>
{{% endif %}}
<table class="cq-table{{{{ ' cq-table-lg' if sectioned_items else '' }}}}">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {{% if section_rows.color %}}
            <th style="text-align: center; white-space: nowrap;">Color</th>
            {{% endif %}}
            {{# No is glass numbering, so a quotation shows it in its Glass section only; the
               combined table other documents print keeps it as before. #}}
            {{% if section_rows.glass or section == 'All' %}}
            <th style="text-align: center; white-space: nowrap;">No</th>
            {{% endif %}}
            {{% if section_rows.glass %}}
            <th style="text-align: center; white-space: nowrap;">Width</th>
            <th style="text-align: center; white-space: nowrap;">Height</th>
            {{% endif %}}
            {{# Only glass has pieces distinct from qty (cut sizes, sheets). Without glass the two
               columns always matched, so show one — named like the Job Card's sections: Pcs for
               aluminium, Qty for everything else. #}}
            {{% if section_rows.glass %}}
            <th style="text-align: center; white-space: nowrap;">Pcs</th>
            <th style="text-align: center; white-space: nowrap;">Qty</th>
            {{% else %}}
            <th style="text-align: center; white-space: nowrap;">{{{{ 'Qty' if section_rows.non_aluminium else 'Pcs' }}}}</th>
            {{% endif %}}
            <th style="text-align: right; white-space: nowrap;">Rate</th>
            <th class="cq-uom" style="text-align: center; white-space: nowrap;">UOM</th>
            {{% if show_glass_services %}}
            <th style="text-align: left; white-space: nowrap;" title="Polish Sides">{{{{ 'PS' if short_glass_service_headers else 'Polish Sides' }}}}</th>
            <th style="text-align: center; white-space: nowrap;" title="Holes">{{{{ 'HL' if short_glass_service_headers else 'Holes' }}}}</th>
            <th style="text-align: center; white-space: nowrap;" title="Notches">{{{{ 'NT' if short_glass_service_headers else 'Notches' }}}}</th>
            {{% endif %}}
            <th style="text-align: right; white-space: nowrap;">Amount</th>
        </tr>
    </thead>
    <tbody>
        {{% set quotation_totals = namespace(pcs=0, qty=0, holes=0, notches=0) %}}
        {{% for parent in section_rows.items %}}
            {{% if true %}}
                {{% set parent_category = parent.custom_product_category or '' %}}
                {{% set pieces = parent.qty or 0 %}}
                {{% set qty = parent.qty or 0 %}}
                {{% set uom = parent.uom or '' %}}
                {{% if parent_category == 'Aluminium' %}}
                    {{% set qty = parent.qty or 0 %}}
                    {{% set uom = parent.uom or 'Nos' %}}
                {{% elif parent_category == 'Glass' %}}
                    {{% if parent.custom_glass_sale_mode == 'Full Sheet' %}}
                        {{% set qty = parent.qty or 0 %}}
                        {{% set uom = 'Nos' %}}
                    {{% elif parent.custom_glass_sale_mode == 'Sheet' %}}
                        {{% set pieces = parent.custom_sheet_pcs or 0 %}}
                        {{% set qty = parent.qty or 0 %}}
                        {{% set uom = parent.uom or 'Square Foot' %}}
                    {{% else %}}
                        {{% set qty = (parent.custom_area_sqft or 0) * (parent.qty or 0) %}}
                        {{% set uom = parent.uom or 'Square Foot' %}}
                    {{% endif %}}
                {{% endif %}}
                {{# Quotation glass qty prints truncated to 2dp (12.259 -> 12.25, never rounded up).
                   The inner flt(.., 6) absorbs float noise so 12.25 * 100 = 1224.9999... stays 1225. #}}
                {{% set qty_display = frappe.utils.flt(qty, 3) %}}
                {{% set qty_label = qty_display %}}
                {{% if doc.doctype == 'Quotation' and parent_category == 'Glass' %}}
                    {{% set qty_display = (frappe.utils.flt(qty * 100, 6)|int) / 100 %}}
                    {{% set qty_label = '%.2f'|format(qty_display) %}}
                {{% endif %}}
                {{% set child_rows = namespace(items=[]) %}}
                {{% for child in doc.items %}}
                    {{% if child.custom_auto_generated and child.custom_parent_row_idx == parent.idx %}}
                        {{% set child_rows.items = child_rows.items + [child] %}}
                    {{% endif %}}
                {{% endfor %}}
                {{% set line = namespace(amount=parent.amount or 0) %}}
                {{% for child in child_rows.items %}}
                        {{% set line.amount = line.amount + (child.amount or 0) %}}
                {{% endfor %}}
                {{% set section_rows.amount = section_rows.amount + line.amount %}}
                {{% if parent_category == 'Glass' %}}
                    {{% set quotation_totals.pcs = quotation_totals.pcs + frappe.utils.flt(pieces, 2) %}}
                {{% endif %}}
                {{% set quotation_totals.qty = quotation_totals.qty + qty_display %}}
                {{% set quotation_totals.holes = quotation_totals.holes + frappe.utils.cint(parent.custom_holes or 0) %}}
                {{% set quotation_totals.notches = quotation_totals.notches + frappe.utils.cint(parent.custom_notches or 0) %}}
                {{% set is_sheet_glass = parent_category == 'Glass' and parent.custom_glass_sale_mode == 'Sheet' %}}
                {{% set width_sides = 0 if is_sheet_glass else frappe.utils.cint(parent.custom_polish_width_sides or 0) %}}
                {{% set height_sides = 0 if is_sheet_glass else frappe.utils.cint(parent.custom_polish_height_sides or 0) %}}
                {{% if parent_category == 'Glass' and not is_sheet_glass and not width_sides and not height_sides and frappe.utils.cint(parent.custom_polishing or 0) %}}
                    {{% set width_sides = 2 %}}
                    {{% set height_sides = 2 %}}
                {{% endif %}}
                {{% set polish_sides = width_sides + height_sides %}}
                {{% set glass_service = namespace(polish_amount=0, holes_amount=0, notches_amount=0) %}}
                {{% set display_width = '-' %}}
                {{% set display_height = '-' %}}
                {{% set display_rate = parent.rate or 0 %}}
                {{% if parent_category == 'Glass' %}}
                    {{% if is_sheet_glass %}}
                        {{# Sheet glass has no cut width/height - show the sheet size chosen
                           (e.g. "1220 x 1830") as one label instead of splitting it across
                           the Width/Height columns, which would look like ordinary cut
                           dimensions and hide that this is a whole sheet. #}}
                        {{% set display_width = (parent.custom_sheet_size or '-')|trim or '-' %}}
                        {{% set display_height = '-' %}}
                    {{% else %}}
                        {{% set display_width = format_dimension(parent.custom_width_mm, parent.custom_dimension_uom) %}}
                        {{% set display_height = format_dimension(parent.custom_height_mm, parent.custom_dimension_uom) %}}
                    {{% endif %}}
                    {{% if parent.custom_glass_sale_mode not in ['Full Sheet', 'Sheet'] and frappe.utils.flt(parent.custom_area_sqft or 0) > 0 %}}
                        {{% set display_rate = (parent.rate or 0) / frappe.utils.flt(parent.custom_area_sqft or 0) %}}
                    {{% endif %}}
                {{% endif %}}
                {{% for child in child_rows.items %}}
                    {{% set child_label = ((child.item_name or child.item_code or '')|lower) %}}
                    {{% if 'polish' in child_label %}}
                        {{% set glass_service.polish_amount = child.amount or 0 %}}
                    {{% elif 'hole' in child_label %}}
                        {{% set glass_service.holes_amount = child.amount or 0 %}}
                    {{% elif 'notch' in child_label %}}
                        {{% set glass_service.notches_amount = child.amount or 0 %}}
                    {{% endif %}}
                {{% endfor %}}
                <tr>
                    <td style="font-weight: bold; white-space: nowrap;">{{{{ parent.item_code or '' }}}}</td>
                    {{# A block with a minimum width is what wkhtmltopdf's table layout honours — it keeps the
                       glass table's many fixed-width columns from squeezing Item to a word per line. #}}
                    <td><div{{{{ ' class="cq-item-glass"' if section_rows.glass else '' }}}}>{{{{ parent.item_name or parent.item_code or '' }}}}</div></td>
                    {{% if section_rows.color %}}
                    <td style="text-align: center; white-space: nowrap;">
                        {{{{ parent.custom_aluminium_color or '-' }}}}
                    </td>
                    {{% endif %}}
                    {{% if section_rows.glass or section == 'All' %}}
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if parent_category == 'Glass' %}}{{{{ parent.custom_numbering or '-' }}}}{{% else %}}-{{% endif %}}
                    </td>
                    {{% endif %}}
                    {{% if section_rows.glass %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ display_width }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ display_height }}}}</td>
                    {{% endif %}}
                    {{% if section_rows.glass %}}
                    <td style="text-align: center; white-space: nowrap;">{{% if parent_category == 'Glass' %}}{{{{ frappe.utils.flt(pieces, 2) }}}}{{% else %}}-{{% endif %}}</td>
                    {{% endif %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ qty_label }}}}</td>
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(display_rate, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                    <td class="cq-uom" style="text-align: center; white-space: nowrap;">{{{{ print_uom(parent, uom) }}}}</td>
                    {{% if show_glass_services %}}
                    {{# Polish / Holes / Notches: the count and its "(Sh …)" charge each stay whole, but the
                       charge may drop to a second line, so these columns never squeeze the Item column. #}}
                    <td>
                        {{% if parent_category == 'Glass' and polish_sides > 0 %}}
                            {{{{ polish_sides }}}}
                            {{% if glass_service.polish_amount %}} <span style="white-space: nowrap;">({{{{ frappe.format_value(glass_service.polish_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}})</span>{{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    <td style="text-align: center;">
                        {{% if parent_category == 'Glass' and not is_sheet_glass and frappe.utils.cint(parent.custom_holes or 0) > 0 %}}
                            {{{{ frappe.utils.cint(parent.custom_holes or 0) }}}}
                            {{% if glass_service.holes_amount %}} <span style="white-space: nowrap;">({{{{ frappe.format_value(glass_service.holes_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}})</span>{{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    <td style="text-align: center;">
                        {{% if parent_category == 'Glass' and not is_sheet_glass and frappe.utils.cint(parent.custom_notches or 0) > 0 %}}
                            {{{{ frappe.utils.cint(parent.custom_notches or 0) }}}}
                            {{% if glass_service.notches_amount %}} <span style="white-space: nowrap;">({{{{ frappe.format_value(glass_service.notches_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}})</span>{{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    {{% endif %}}
                    {{# Quotation / Sales Invoice: a cut-size glass row shows no amount of its own — only
                       the Glass section's total below. Sheet and full-sheet rows keep theirs. #}}
                    {{% set hide_row_amount = large_glass_table and parent_category == 'Glass' and parent.custom_glass_sale_mode not in ['Sheet', 'Full Sheet'] %}}
                    <td style="text-align: right; white-space: nowrap;">{{% if hide_row_amount %}}&nbsp;{{% else %}}{{{{ frappe.format_value(line.amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}{{% endif %}}</td>
                </tr>
            {{% endif %}}
        {{% endfor %}}
        {{% if doc.doctype in ['Quotation', 'Sales Invoice'] %}}
        <tr>
            <td colspan="{{{{ 3 if section_rows.color else 2 }}}}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% if section_rows.glass %}}
            <td colspan="3" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% elif section == 'All' %}}
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% endif %}}
            {{% if section_rows.glass %}}
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ frappe.utils.flt(quotation_totals.pcs, 2) }}}}</td>
            {{% endif %}}
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ frappe.utils.flt(quotation_totals.qty, 3) }}}}</td>
            <td colspan="2" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% if show_glass_services %}}
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ quotation_totals.holes }}}}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ quotation_totals.notches }}}}</td>
            {{% endif %}}
            {{% if section != 'All' %}}
            <td style="text-align: right; white-space: nowrap; font-weight: bold;">{{{{ frappe.format_value(section_rows.amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
            {{% else %}}
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% endif %}}
        </tr>
        {{% endif %}}
    </tbody>
</table>
{{% endif %}}
{{% endif %}}
{{% endfor %}}

{{# A credit note's tax is negative, so test for any tax at all — '> 0' sent returns down the
   'no tax row, add a visual 16%' path and printed VAT on top of an already VAT-inclusive total. #}}
{{% set has_real_tax = frappe.utils.flt(doc.total_taxes_and_charges or 0) != 0 %}}
{{% set subtotal_amount = frappe.utils.flt(doc.grand_total or 0) - frappe.utils.flt(doc.total_taxes_and_charges or 0) if has_real_tax else frappe.utils.flt(doc.grand_total or 0) %}}
{{% set vat_amount = frappe.utils.flt(doc.total_taxes_and_charges or 0) if has_real_tax else subtotal_amount * 0.16 %}}
{{% set total_amount = frappe.utils.flt(doc.grand_total or 0) if has_real_tax else subtotal_amount + vat_amount %}}
{{% set outstanding_display_amount = (frappe.utils.flt(doc.outstanding_amount or 0) * 1.16) if doc.doctype == 'Sales Invoice' and frappe.utils.flt(doc.total_taxes_and_charges or 0) == 0 else frappe.utils.flt(doc.outstanding_amount or 0) %}}
{{% set paid_display_amount = 0 %}}
{{% if doc.doctype == 'Sales Invoice' and (doc.docstatus != 1 or doc.status == 'Unpaid' or doc.status == 'Overdue') %}}
    {{% set outstanding_display_amount = total_amount %}}
{{% elif doc.doctype == 'Sales Invoice' %}}
    {{% set paid_display_amount = frappe.utils.flt(total_amount - outstanding_display_amount) %}}
    {{% if paid_display_amount < 0 or (paid_display_amount > -0.5 and paid_display_amount < 0.5) %}}
        {{% set paid_display_amount = 0 %}}
        {{% set outstanding_display_amount = total_amount %}}
    {{% endif %}}
{{% endif %}}

<div class="row" style="margin-top: 30px;">
    <div class="col-xs-7">
        <div style="padding: 15px; background: #f8f9fa; border-radius: 4px; overflow: hidden; box-sizing: border-box;">
            <div style="font-size: 13px; color: #6c757d; margin-bottom: 5px;">Terms & Conditions</div>
            <div style="font-size: 16px; color: #495057;">
                {terms}
            </div>
            {payment_details}
        </div>
    </div>
    <div class="col-xs-5 text-right">
        <div style="padding: 15px; border: 1px solid #dee2e6; border-radius: 4px; background: #fff;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; color: #6c757d; text-transform: uppercase; margin-bottom: 8px;">
                <span>Subtotal</span>
                <span>{{{{ frappe.format_value(subtotal_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; color: #6c757d; text-transform: uppercase; padding-bottom: 10px; border-bottom: 1px solid #dee2e6;">
                <span>V.A.T (16%)</span>
                <span>{{{{ frappe.format_value(vat_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</span>
            </div>
            <div style="margin-top: 12px;">
                <div style="font-size: 14px; color: #6c757d; margin-bottom: 5px; text-transform: uppercase;">Total</div>
                <div style="font-size: 24px; font-weight: bold; color: #2c3e50;">{{{{ frappe.format_value(total_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</div>
            </div>
            {{% if doc.doctype == 'Sales Invoice' %}}
            <div style="border-top: 1px solid #dee2e6; margin-top: 10px; padding-top: 10px;">
                <div style="font-size: 12px; color: #6c757d; text-transform: uppercase;">Paid Amount</div>
                <div style="font-size: 16px; font-weight: bold; color: #2c3e50; margin-bottom: 8px;">{{{{ frappe.format_value(paid_display_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</div>
                <div style="font-size: 12px; color: #6c757d; text-transform: uppercase;">Outstanding Amount</div>
                <div style="font-size: 16px; font-weight: bold; color: #e74c3c;">{{{{ frappe.format_value(outstanding_display_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</div>
            </div>
            {{% endif %}}
        </div>
    </div>
</div>

{{% if doc.doctype == 'Sales Invoice' %}}
{{# One line, not stacked. Empty inline-blocks sit on the text baseline, so each dotted
   line lines up with its label (table-cell borders drifted below it in wkhtmltopdf).
   A credit note has no delivery: it drops Vehicle No, reads APPROVED BY instead of
   COLLECTED BY, and widens the other two. #}}
<div style="margin-top: 40px; white-space: nowrap; font-size: 13px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">
    {{% if doc.get('is_return') %}}
    APPROVED BY <span style="display: inline-block; width: 45%; border-bottom: 1px dotted #2c3e50;"></span>
    &nbsp;&nbsp; Signature <span style="display: inline-block; width: 30%; border-bottom: 1px dotted #2c3e50;"></span>
    {{% else %}}
    Collected By <span style="display: inline-block; width: 36%; border-bottom: 1px dotted #2c3e50;"></span>
    &nbsp;&nbsp; Vehicle No <span style="display: inline-block; width: 16%; border-bottom: 1px dotted #2c3e50;"></span>
    &nbsp;&nbsp; Signature <span style="display: inline-block; width: 20%; border-bottom: 1px dotted #2c3e50;"></span>
    {{% endif %}}
</div>
{{% endif %}}
"""

    return CRYSTAL_PAGE_STYLE + html


def build_crystal_invoice_list_html():
    """The Invoices / Cash Sales pages' Download: the filtered invoice list on the Crystal
    letterhead, styled like the Crystal Quotation. Plain Jinja (not a .format() string), rendered
    by api.download_sales_invoices_pdf; Cash Sales leaves out the PIN and Balance columns."""
    return CRYSTAL_PAGE_STYLE + """
<div class="letterhead" style="margin-bottom: 20px;">
    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="display: block; width: 100%; height: auto;" alt="Crystal Aluminium Works">
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">

<div class="text-center" style="margin-bottom: 16px; font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px;">
    {{ title }}
</div>

<div class="row" style="margin-bottom: 14px;">
    <div class="col-xs-7">
        <div style="font-size: 13px; font-weight: bold; color: #000; text-transform: uppercase;">Period: {{ period }}</div>
        {% if search %}
        <div style="margin-top: 4px; font-size: 13px; font-weight: bold; color: #000; text-transform: uppercase;">Search: {{ search }}</div>
        {% endif %}
    </div>
    <div class="col-xs-5 text-right">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Generated</div>
        <div style="font-size: 13px;">{{ frappe.utils.format_datetime(generated_on, "dd-MM-yyyy HH:mm") }}</div>
    </div>
</div>

<style>
    .ci-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .ci-table th {
        background-color: #f8f9fa; color: #2c3e50; padding: 6px 4px;
        border-bottom: 2px solid #dee2e6; font-size: 10px; text-transform: uppercase;
    }
    .ci-table td { padding: 6px 4px; border-bottom: 1px solid #dee2e6; vertical-align: middle; font-size: 10px; }
    .ci-table tr.ci-cancelled td { color: #95a5a6; text-decoration: line-through; }
    .ci-table tfoot td { border-top: 2px solid #2c3e50; border-bottom: none; font-weight: bold; font-size: 11px; }
</style>

<table class="ci-table">
    <thead>
        <tr>
            <th style="text-align: center; width: 4%;">#</th>
            <th style="text-align: left;">Customer</th>
            <th style="text-align: left;">Invoice Number</th>
            <th style="text-align: center;">Date</th>
            {% if show_pin_and_balance %}<th style="text-align: left;">PIN</th>{% endif %}
            <th style="text-align: right;">Amount</th>
            {% if show_pin_and_balance %}<th style="text-align: right;">Balance</th>{% endif %}
            <th style="text-align: center;">Status</th>
        </tr>
    </thead>
    <tbody>
        {% for row in rows %}
        <tr class="{{ 'ci-cancelled' if row.docstatus == 2 else '' }}">
            <td style="text-align: center;">{{ loop.index }}</td>
            <td style="text-align: left; font-weight: 600;">{{ row.custom_customer_name or row.customer_name or row.customer or '-' }}</td>
            <td style="text-align: left;">{{ row.name }}</td>
            <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.formatdate(row.posting_date) if row.posting_date else '-' }}</td>
            {% if show_pin_and_balance %}<td style="text-align: left;">{{ row.pin or '-' }}</td>{% endif %}
            <td style="text-align: right; white-space: nowrap;">{{ frappe.utils.fmt_money(row.display_amount, currency=row.currency or 'KES') }}</td>
            {% if show_pin_and_balance %}<td style="text-align: right; white-space: nowrap;">{{ frappe.utils.fmt_money(row.display_balance, currency=row.currency or 'KES') }}</td>{% endif %}
            <td style="text-align: center;">{{ row.display_status or '-' }}</td>
        </tr>
        {% else %}
        <tr><td colspan="{{ 8 if show_pin_and_balance else 6 }}" style="text-align: center; padding: 20px; color: #7f8c8d;">No invoices match these filters.</td></tr>
        {% endfor %}
    </tbody>
    {% if rows %}
    <tfoot>
        <tr>
            <td colspan="{{ 5 if show_pin_and_balance else 4 }}" style="text-align: left; text-transform: uppercase;">
                Total ({{ rows|selectattr('docstatus', 'ne', 2)|list|length }} invoices{% if rows|selectattr('docstatus', 'eq', 2)|list|length %}, cancelled excluded{% endif %})
            </td>
            <td style="text-align: right; white-space: nowrap;">{{ frappe.utils.fmt_money(total_amount, currency='KES') }}</td>
            {% if show_pin_and_balance %}<td style="text-align: right; white-space: nowrap;">{{ frappe.utils.fmt_money(total_balance, currency='KES') }}</td>{% endif %}
            <td></td>
        </tr>
    </tfoot>
    {% endif %}
</table>
"""


def build_crystal_payment_receipt_print_format_html():
    return CRYSTAL_PAGE_STYLE + """
{% set history = doc %}

<div style="width: 100%; margin-bottom: 22px;">
    <div style="display: table; width: 100%; table-layout: fixed;">
        <div style="display: table-row;">
            <div style="display: table-cell; width: 70%; vertical-align: top; padding-right: 16px;">
                <div style="margin-left: -48px;">
                    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="display: block; width: calc(100% + 48px); max-width: none; height: auto;" alt="Crystal Aluminium Works">
                </div>
            </div>
            <div style="display: table-cell; width: 240px; text-align: right; vertical-align: top;">
                <div style="font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Receipt</div>
                <div style="display: inline-block; min-width: 220px; padding: 12px 16px; border: 1px solid #dfe6e9; border-radius: 4px; text-align: left;">
                    <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Date</div>
                    <div style="font-size: 16px; font-weight: bold; margin-top: 4px;">{{ frappe.utils.formatdate(history.creation) }}</div>
                    <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 12px;">Receipt No</div>
                    <div style="font-size: 14px; font-weight: 600; margin-top: 4px;">{{ history.receipt_no or history.name }}</div>
                </div>
            </div>
        </div>
    </div>
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">

<div class="row" style="margin-bottom: 30px;">
    <div class="col-xs-6">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Customer Name</div>
        <div style="font-size: 16px; font-weight: bold;">{{ history.customer_name or history.customer }}</div>
    </div>
    <div class="col-xs-6 text-right">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Job Card No</div>
        <div style="font-size: 16px; font-weight: bold;">{{ history.job_card }}</div>
    </div>
</div>

<div style="padding: 18px; background: #f8f9fa; border-radius: 4px; margin-bottom: 20px;">
    <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; color: #6c757d; text-transform: uppercase; padding-bottom: 10px; border-bottom: 1px solid #dee2e6;">
        <span>Payment Mode</span>
        <span>{{ history.payment_mode or '-' }}</span>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; color: #6c757d; text-transform: uppercase; padding: 10px 0; border-bottom: 1px solid #dee2e6;">
        <span>Payment Option</span>
        <span>{{ history.payment_option or '-' }}</span>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 12px;">
        <span style="font-size: 14px; color: #6c757d; text-transform: uppercase;">Amount Received</span>
        <span style="font-size: 24px; font-weight: bold; color: #2c3e50;">{{ frappe.format_value(history.amount_paid, df={'fieldtype': 'Currency'}, doc=history) }}</span>
    </div>
</div>

<div class="row">
    <div class="col-xs-6">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Paid To Date</div>
        <div style="font-size: 15px; font-weight: 600;">{{ frappe.format_value(history.payment_amount, df={'fieldtype': 'Currency'}, doc=history) }}</div>
    </div>
    <div class="col-xs-6 text-right">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Balance</div>
        <div style="font-size: 15px; font-weight: 600;">{{ frappe.format_value(history.balance_amount, df={'fieldtype': 'Currency'}, doc=history) }}</div>
    </div>
</div>

{% set quotation = frappe.get_doc('Quotation', history.quotation) if history.quotation else None %}
{% set receipt_items = (quotation.items if quotation else [])|rejectattr('custom_auto_generated')|list %}
{% if receipt_items %}
<style>
    .pr-items-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    .pr-items-table th { background-color: #f8f9fa; color: #2c3e50; padding: 8px 6px; border-bottom: 2px solid #dee2e6; font-size: 11px; text-align: left; }
    .pr-items-table td { padding: 8px 6px; border-bottom: 1px solid #dee2e6; font-size: 12px; }
    .pr-items-table .pr-right { text-align: right; }
</style>
<table class="pr-items-table">
    <thead>
        <tr>
            <th>Item</th>
            <th class="pr-right">Qty/Pcs</th>
            <th>UOM</th>
            <th class="pr-right">Amount</th>
        </tr>
    </thead>
    <tbody>
        {% for row in receipt_items %}
        {% set qty = row.custom_sheet_pcs if (row.custom_product_category == 'Glass' and row.custom_glass_sale_mode == 'Sheet' and frappe.utils.flt(row.custom_sheet_pcs or 0) > 0) else (row.custom_ceiling_sq_m if (row.custom_product_category == 'Ceiling' and frappe.utils.flt(row.custom_ceiling_sq_m or 0) > 0) else row.qty) %}
        <tr>
            <td>{{ row.item_name or row.item_code }}</td>
            <td class="pr-right">{{ frappe.utils.flt(qty, 2) }}</td>
            <td>{{ row.uom or '-' }}</td>
            <td class="pr-right">{{ frappe.format_value(row.amount, df={'fieldtype': 'Currency'}, doc=history) }}</td>
        </tr>
        {% endfor %}
    </tbody>
</table>
{% endif %}
"""


def build_crystal_job_card_print_format_html():
    return CRYSTAL_PAGE_STYLE + """
{% set job_card = doc %}
{% set quotation = frappe.get_doc('Quotation', job_card.quotation) if job_card.quotation else None %}
{% set print_items = quotation.items if quotation else [] %}
{% set section_filter = section_filter if section_filter is defined else '' %}

{% macro short_uom(value) %}
    {% set normalized = (value or '')|trim|lower %}
    {% if normalized == 'square foot' %}sft
    {% elif normalized == 'square meter' %}sqm
    {% elif normalized in ['meter', 'metre', 'len'] %}len
    {% elif normalized in ['running foot', 'rft'] %}rft
    {% elif normalized == 'nos' %}nos
    {% else %}{{ value or '-' }}{% endif %}
{% endmacro %}

{% macro format_dimension(mm_value, uom) %}
    {% if not (mm_value or 0) %}-
    {% elif (uom or '')|lower == 'inches' %}{{ frappe.utils.flt(mm_value / 25.4, 2) }}"
    {% else %}{{ '%.0f'|format(mm_value or 0) }}mm{% endif %}
{% endmacro %}

<div style="width: 100%; margin-bottom: 22px;">
    <div style="display: table; width: 100%; table-layout: fixed;">
        <div style="display: table-row;">
            <div style="display: table-cell; width: 70%; vertical-align: top; padding-right: 16px;">
                <div style="margin-left: -48px;">
                    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="display: block; width: calc(100% + 48px); max-width: none; height: auto;" alt="Crystal Aluminium Works">
                </div>
            </div>
            <div style="display: table-cell; width: 240px; text-align: right; vertical-align: top;">
                <div style="font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px; margin-bottom: {{ 4 if section_filter else 12 }}px;">Job Card</div>
                {% if section_filter %}
                <div style="font-size: 13px; font-weight: 600; color: #7f8c8d; text-transform: uppercase; margin-bottom: 12px;">{{ section_filter }}</div>
                {% endif %}
                <div style="display: inline-block; min-width: 220px; padding: 12px 16px; border: 1px solid #dfe6e9; border-radius: 4px; text-align: left;">
                    <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Approved Date</div>
                    <div style="font-size: 16px; font-weight: bold; margin-top: 4px;">{{ frappe.utils.formatdate(job_card.creation) }}</div>
                    <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 12px;">Job Card No</div>
                    <div style="font-size: 14px; font-weight: 600; margin-top: 4px;">{{ job_card.name }}</div>
                </div>
            </div>
        </div>
    </div>
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">

<style>
    .cq-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }
    .cq-table th {
        background-color: #f8f9fa;
        color: #2c3e50;
        padding: 6px 4px;
        border-bottom: 2px solid #dee2e6;
        font-size: 14px;
    }
    .cq-table td {
        padding: 6px 4px;
        border-bottom: 1px solid #dee2e6;
        vertical-align: middle;
        font-size: 14px;
    }
    .jc-section {
        padding: 14px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 11px;
        color: #495057;
    }
    .jc-section-title {
        margin: 10px 0 8px 0;
        font-size: 13px;
        font-weight: bold;
        color: #2c3e50;
        text-transform: uppercase;
    }
</style>

{#
    Items are split into four download groups: Glass (Cut Size and Sheet
    as separate tables, since their columns differ), Aluminium, Accessories
    and Ceiling. Fittings, Rubber, Silicone and anything uncategorised share
    the same Code/Item/Qty/UOM layout, so they go out as one Accessories
    table rather than a sheet each. section_filter is a group name.
#}
{% set has_ceiling_parent = namespace(value=false) %}
{% set has_ceiling_bundle = namespace(value=false) %}
{% set ceiling_single_labels = namespace(items=[]) %}
{% set ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'] %}
{% set ceiling_board_item_codes = frappe.call("crystal_alluminium_works.api.get_ceiling_board_item_codes") %}
{% for row in print_items %}
    {% if not row.custom_auto_generated and (row.custom_product_category or '') == 'Ceiling' %}
        {% set has_ceiling_parent.value = true %}
        {% if frappe.utils.flt(row.custom_ceiling_sq_m or 0) > 0 %}
            {% set has_ceiling_bundle.value = true %}
        {% else %}
            {% set single_label = 'Board' if row.item_code in ceiling_board_item_codes else (row.item_name or row.item_code or '') %}
            {% if single_label and single_label not in ceiling_single_labels.items %}
                {% set ceiling_single_labels.items = ceiling_single_labels.items + [single_label] %}
            {% endif %}
        {% endif %}
    {% endif %}
{% endfor %}

{% set job_card_sections = [
    {'key': 'Glass Cut Size', 'group': 'Glass', 'label': 'Glass Items — Cut Size'},
    {'key': 'Glass Sheet', 'group': 'Glass', 'label': 'Glass Items — Sheet'},
    {'key': 'Aluminium', 'group': 'Aluminium', 'label': 'Aluminium Items'},
    {'key': 'Accessories', 'group': 'Accessories', 'label': 'Accessories'},
    {'key': 'Ceiling', 'group': 'Ceiling', 'label': 'Ceiling Items'},
] %}

{% for section in job_card_sections if not section_filter or section.group == section_filter %}
{% if section.key == 'Ceiling' %}
{% if has_ceiling_parent.value %}
{% set ceiling_columns = ceiling_component_labels if has_ceiling_bundle.value else ceiling_single_labels.items %}
<div class="jc-section-title">{{ section.label }}</div>
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: center; white-space: nowrap;">No</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {% if has_ceiling_bundle.value %}
            <th style="text-align: center; white-space: nowrap;">Quantity</th>
            {% endif %}
            <th style="text-align: center; white-space: nowrap;">UOM</th>
            {% for column in ceiling_columns %}
            <th style="text-align: center; white-space: nowrap;">{{ column }}</th>
            {% endfor %}
        </tr>
    </thead>
    <tbody>
        {% for parent in print_items %}
            {% if not parent.custom_auto_generated and (parent.custom_product_category or '') == 'Ceiling' %}
                {% set is_bundle = frappe.utils.flt(parent.custom_ceiling_sq_m or 0) > 0 %}
                {% set ceiling_quantity = parent.custom_ceiling_sq_m or 0 %}
                {% set item_label = 'Board' if parent.item_code in ceiling_board_item_codes else (parent.item_name or parent.item_code or '') %}
                {% set display_uom = parent.uom or 'Nos' %}
                {% if is_bundle or parent.item_code in ceiling_board_item_codes %}
                    {% set display_uom = parent.uom or 'Square Meter' %}
                {% endif %}
                {% set child_rows = namespace(items=[]) %}
                {% for child in print_items %}
                    {% if child.custom_auto_generated and child.custom_parent_row_idx == parent.idx %}
                        {% set child_rows.items = child_rows.items + [child] %}
                    {% endif %}
                {% endfor %}
                <tr>
                    <td style="text-align: center; white-space: nowrap;">{{ parent.idx or '-' }}</td>
                    <td>{{ parent.item_name or parent.item_code or '' }}</td>
                    {% if has_ceiling_bundle.value %}
                    <td style="text-align: center; white-space: nowrap;">
                        {% if is_bundle %}{{ frappe.utils.flt(ceiling_quantity, 3) }}{% else %}-{% endif %}
                    </td>
                    {% endif %}
                    <td style="text-align: center; white-space: nowrap;">{{ short_uom(display_uom) }}</td>
                    {% for column in ceiling_columns %}
                        {% set column_qty = namespace(value='-') %}
                        {% if is_bundle %}
                            {% if column == 'Board' %}
                                {% set column_qty.value = frappe.utils.cint((ceiling_quantity or 0) / 0.36) %}
                            {% else %}
                                {% for child in child_rows.items %}
                                    {% if (child.item_code or child.item_name or '') == column %}
                                        {% set column_qty.value = frappe.utils.flt(child.qty or 0, 0) %}
                                    {% endif %}
                                {% endfor %}
                            {% endif %}
                        {% elif item_label == column %}
                            {% set column_qty.value = frappe.utils.flt(parent.qty or 0, 0) %}
                        {% endif %}
                    <td style="text-align: center; white-space: nowrap;">{{ column_qty.value }}</td>
                    {% endfor %}
                </tr>
            {% endif %}
        {% endfor %}
    </tbody>
</table>
{% endif %}
{% else %}
{% set section_data = namespace(rows=[], has_color=false, has_description=false) %}
{% for row in print_items %}
    {% if not row.custom_auto_generated %}
        {% set row_category = row.custom_product_category or '' %}
        {% if row_category == 'Glass' %}
            {% set row_section = 'Glass Sheet' if row.custom_glass_sale_mode == 'Sheet' else 'Glass Cut Size' %}
        {% elif row_category in ['Aluminium', 'Ceiling'] %}
            {% set row_section = row_category %}
        {% else %}
            {% set row_section = 'Accessories' %}
        {% endif %}
        {% if row_section == section.key %}
            {% set section_data.rows = section_data.rows + [row] %}
            {% if (row.custom_aluminium_color or '')|trim %}
                {% set section_data.has_color = true %}
            {% endif %}
            {# The Builder's free-text Description (e.g. lengths/pieces for G85 Owners Good). Blank
               unless typed; ignore one that only repeats the item name. #}
            {% set row_description = (row.description or '')|striptags|trim %}
            {% if section.key == 'Aluminium' and row_description and row_description != (row.item_name or '')|trim %}
                {% set section_data.has_description = true %}
            {% endif %}
        {% endif %}
    {% endif %}
{% endfor %}

{% if section_data.rows %}
<div class="jc-section-title">{{ section.label }}</div>
{% if section.key == 'Glass Cut Size' %}
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            <th style="text-align: center; white-space: nowrap;">Pcs</th>
            <th style="text-align: center; white-space: nowrap;">Qty</th>
            <th style="text-align: center; white-space: nowrap;">UOM</th>
            <th style="text-align: center; white-space: nowrap;">No</th>
            <th style="text-align: center; white-space: nowrap;">Width</th>
            <th style="text-align: center; white-space: nowrap;">Height</th>
            <th style="text-align: center; white-space: nowrap;" title="W = sides along the width, H = sides along the height">Polish Sides (W/H)</th>
            <th style="text-align: center; white-space: nowrap;">Holes</th>
            <th style="text-align: center; white-space: nowrap;">Notches</th>
        </tr>
    </thead>
    <tbody>
        {% set totals = namespace(pcs=0, qty=0, holes=0, notches=0) %}
        {% for parent in section_data.rows %}
            {% set pieces = parent.qty or 0 %}
            {% if parent.custom_glass_sale_mode == 'Full Sheet' %}
                {% set qty = parent.qty or 0 %}
                {% set uom = 'Nos' %}
            {% else %}
                {% set qty = (parent.custom_area_sqft or 0) * (parent.qty or 0) %}
                {% set uom = parent.uom or 'Square Foot' %}
            {% endif %}
            {% set width_sides = frappe.utils.cint(parent.custom_polish_width_sides or 0) %}
            {% set height_sides = frappe.utils.cint(parent.custom_polish_height_sides or 0) %}
            {% if not width_sides and not height_sides and frappe.utils.cint(parent.custom_polishing or 0) %}
                {% set width_sides = 2 %}
                {% set height_sides = 2 %}
            {% endif %}
            {% set polish_sides = width_sides + height_sides %}
            {% set holes = frappe.utils.cint(parent.custom_holes or 0) %}
            {% set notches = frappe.utils.cint(parent.custom_notches or 0) %}
            {% set totals.pcs = totals.pcs + frappe.utils.flt(pieces, 2) %}
            {% set totals.qty = totals.qty + frappe.utils.flt(qty, 3) %}
            {% set totals.holes = totals.holes + holes %}
            {% set totals.notches = totals.notches + notches %}
            <tr>
                <td style="font-weight: bold; white-space: nowrap;">{{ parent.item_code or '' }}</td>
                <td>{{ parent.item_name or parent.item_code or '' }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(pieces, 2) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(qty, 3) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ short_uom(uom) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ parent.custom_numbering or '-' }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ format_dimension(parent.custom_width_mm, parent.custom_dimension_uom) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ format_dimension(parent.custom_height_mm, parent.custom_dimension_uom) }}</td>
                {# Which edges to polish: W = sides along the width (top/bottom), H = sides along the
                   height (left/right), e.g. "2W + 2H" for all four, "1W" for one long edge. #}
                {% set polish_parts = [] %}
                {% if width_sides > 0 %}{% set polish_parts = polish_parts + [width_sides ~ 'W'] %}{% endif %}
                {% if height_sides > 0 %}{% set polish_parts = polish_parts + [height_sides ~ 'H'] %}{% endif %}
                <td style="text-align: center; white-space: nowrap;">{{ polish_parts|join(' + ') if polish_parts else '-' }}</td>
                <td style="text-align: center; white-space: nowrap;">{% if holes > 0 %}{{ holes }}{% else %}-{% endif %}</td>
                <td style="text-align: center; white-space: nowrap;">{% if notches > 0 %}{{ notches }}{% else %}-{% endif %}</td>
            </tr>
        {% endfor %}
        <tr>
            <td colspan="2" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(totals.pcs, 2) }}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(totals.qty, 3) }}</td>
            <td colspan="5" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ totals.holes }}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ totals.notches }}</td>
        </tr>
    </tbody>
</table>
{% elif section.key == 'Glass Sheet' %}
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            <th style="text-align: center; white-space: nowrap;">No</th>
            <th style="text-align: center; white-space: nowrap;">Sheet Size</th>
            <th style="text-align: center; white-space: nowrap;">Pcs</th>
            <th style="text-align: center; white-space: nowrap;">Qty</th>
            <th style="text-align: center; white-space: nowrap;">UOM</th>
        </tr>
    </thead>
    <tbody>
        {% set totals = namespace(pcs=0, qty=0) %}
        {% for parent in section_data.rows %}
            {% set pieces = parent.custom_sheet_pcs or 0 %}
            {% set qty = parent.qty or 0 %}
            {% set totals.pcs = totals.pcs + frappe.utils.flt(pieces, 2) %}
            {% set totals.qty = totals.qty + frappe.utils.flt(qty, 3) %}
            <tr>
                <td style="font-weight: bold; white-space: nowrap;">{{ parent.item_code or '' }}</td>
                <td>{{ parent.item_name or parent.item_code or '' }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ parent.custom_numbering or '-' }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ (parent.custom_sheet_size or '-')|trim or '-' }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(pieces, 2) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(qty, 3) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ short_uom(parent.uom or 'Square Foot') }}</td>
            </tr>
        {% endfor %}
        <tr>
            <td colspan="4" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(totals.pcs, 2) }}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(totals.qty, 3) }}</td>
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
        </tr>
    </tbody>
</table>
{% else %}
{% set is_aluminium = section.key == 'Aluminium' %}
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {% if section_data.has_description %}
            <th style="text-align: left; white-space: nowrap;">Description</th>
            {% endif %}
            {% if section_data.has_color %}
            <th style="text-align: center; white-space: nowrap;">Color</th>
            {% endif %}
            <th style="text-align: center; white-space: nowrap;">{{ 'Pcs' if is_aluminium else 'Qty' }}</th>
            <th style="text-align: center; white-space: nowrap;">UOM</th>
        </tr>
    </thead>
    <tbody>
        {% set totals = namespace(qty=0) %}
        {% for parent in section_data.rows %}
            {% set totals.qty = totals.qty + frappe.utils.flt(parent.qty or 0, 2) %}
            <tr>
                <td style="font-weight: bold; white-space: nowrap;">{{ parent.item_code or '' }}</td>
                <td>{{ parent.item_name or parent.item_code or '' }}</td>
                {% if section_data.has_description %}
                {% set parent_description = (parent.description or '')|striptags|trim %}
                <td style="white-space: pre-wrap;">{{ parent_description if parent_description and parent_description != (parent.item_name or '')|trim else '-' }}</td>
                {% endif %}
                {% if section_data.has_color %}
                <td style="text-align: center; white-space: nowrap;">{{ parent.custom_aluminium_color or '-' }}</td>
                {% endif %}
                <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(parent.qty or 0, 2) }}</td>
                <td style="text-align: center; white-space: nowrap;">{{ short_uom(parent.uom or ('Nos' if is_aluminium else '')) }}</td>
            </tr>
        {% endfor %}
        {% if is_aluminium %}
        <tr>
            <td colspan="{{ 2 + (1 if section_data.has_color else 0) + (1 if section_data.has_description else 0) }}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(totals.qty, 2) }}</td>
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
        </tr>
        {% endif %}
    </tbody>
</table>
{% endif %}
{% endif %}
{% endif %}
{% endfor %}
"""


STATEMENT_PRINT_FORMAT_NAME = "Crystal Statement of Accounts"


def build_crystal_statement_print_format_html():
    """Crystal Statement of Accounts — rendered by erpnext's Process Statement Of Accounts
    (see process_statement_of_accounts_override.py) with its General Ledger context (data,
    filters, ageing, terms_and_conditions). Shares the Crystal letterhead image with the other
    formats; "Statement" sits beside the customer box with the statement date below it.
    Plain Jinja (not a .format() string)."""
    return CRYSTAL_PAGE_STYLE + """
{% macro voucher_label(voucher_type) %}
    {% set t = (voucher_type or '')|trim %}
    {% if t == 'Job Card' %}JC
    {% elif t == 'Payment' %}PMT
    {% elif t == 'Refund' %}REF
    {% elif t == 'Sales Invoice' %}INV
    {% elif t == 'Credit Note' %}CN
    {% else %}{{ t or '-' }}{% endif %}
{% endmacro %}

{% set customer_id = filters.party[0] if filters.party else None %}
{% set customer_display_name = filters.party_name[0] if filters.party_name else (filters.party[0] if filters.party else '') %}
{% set customer_tax_id = filters.tax_id or (frappe.db.get_value('Customer', customer_id, 'tax_id') if customer_id else '') %}
{% set statement_date = filters.to_date or filters.report_date %}

<style>
    .caw-soa-box {
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 10px 14px;
    }
    .caw-soa-box-flush {
        border-bottom: none;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }
    .caw-soa-label {
        color: #7f8c8d;
        font-size: 11px;
        margin-bottom: 3px;
    }
    .caw-soa-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }
    .caw-soa-table th {
        background-color: #f8f9fa;
        color: #2c3e50;
        padding: 6px 8px;
        border: 1px solid #dee2e6;
        font-size: 10px;
    }
    .caw-soa-table td {
        padding: 6px 8px;
        border: 1px solid #dee2e6;
        vertical-align: middle;
        font-size: 10px;
    }
    .caw-soa-ageing th, .caw-soa-ageing td {
        text-align: center;
        font-size: 9px;
        padding: 5px 3px;
    }
    .caw-soa-ageing th {
        text-transform: uppercase;
    }
</style>

<div class="letterhead" style="margin-bottom: 12px;">
    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="display: block; width: 100%; height: auto;" alt="Crystal Aluminium Works">
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">

<div class="row" style="margin-bottom: 20px;">
    <div class="col-xs-8">
        <div class="caw-soa-box" style="height: 100%;">
            <div style="font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
                Customer: {{ customer_display_name }}
            </div>
            {% if customer_tax_id %}
            <div style="margin-top: 6px; font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
                PIN: {{ customer_tax_id }}
            </div>
            {% endif %}
        </div>
    </div>
    <div class="col-xs-4 text-right">
        <div style="font-size: 26px; font-weight: bold; color: #2c3e50; letter-spacing: 1px; line-height: 1.1;">Statement</div>
        <div style="margin-top: 8px; font-size: 14px; font-weight: bold; color: #000; text-transform: uppercase; white-space: nowrap;">
            Date: {{ frappe.utils.formatdate(statement_date) }}
        </div>
    </div>
</div>

<div class="row" style="margin-bottom: 0;">
    <div class="col-xs-5" style="width: 50%;">&nbsp;</div>
    <div class="col-xs-3" style="width: 25%;">
        <div class="caw-soa-box caw-soa-box-flush">
            <div class="caw-soa-label">Amount Due</div>
            <div style="font-size: 16px; font-weight: bold; color: #2c3e50; white-space: nowrap;">
                {{ frappe.utils.fmt_money(ageing.total_due if ageing else data[-1].balance, currency=filters.presentation_currency) }}
            </div>
        </div>
    </div>
    <div class="col-xs-4" style="width: 25%;">
        <div class="caw-soa-box caw-soa-box-flush">
            <div class="caw-soa-label">Amount Enc.</div>
            <div style="font-size: 16px; font-weight: bold; color: #2c3e50;">&nbsp;</div>
        </div>
    </div>
</div>

<table class="caw-soa-table">
    <thead>
        <tr>
            <th style="width: 14%; text-align: left;">Date</th>
            <th style="width: 40%; text-align: left;">Transaction</th>
            <th style="width: 23%; text-align: right;">Amount</th>
            <th style="width: 23%; text-align: right;">Balance</th>
        </tr>
    </thead>
    <tbody>
        {% for row in data %}
        <tr>
            {% if row.posting_date %}
                <td>{{ frappe.format(row.posting_date, 'Date') }}</td>
                <td>
                    {{ voucher_label(row.voucher_type) }} #{{ row.voucher_no }}
                    {% if not (filters.party or filters.account) %}
                        <br>{{ row.party or row.account }}
                    {% endif %}
                    {% if row.bill_no %}
                        <br>{{ _("Supplier Invoice No") }}: {{ row.bill_no }}
                    {% endif %}
                    {% if filters.show_remarks and row.remarks %}
                        <br>{{ _("Remarks") }}: {{ row.remarks }}
                    {% endif %}
                </td>
                <td style="text-align: right">
                    {{ frappe.utils.fmt_money(frappe.utils.flt(row.debit) - frappe.utils.flt(row.credit), currency=filters.presentation_currency) }}
                </td>
                <td style="text-align: right">
                    {{ frappe.utils.fmt_money(row.balance, currency=filters.presentation_currency) }}
                </td>
            {% else %}
                <td></td>
                <td><b>{{ frappe.format(row.account, {"fieldtype": "Link"}) or "&nbsp;" }}</b></td>
                <td style="text-align: right">
                    {{ row.get('account', '') and frappe.utils.fmt_money(frappe.utils.flt(row.debit) - frappe.utils.flt(row.credit), currency=filters.presentation_currency) }}
                </td>
                <td style="text-align: right">
                    {{ frappe.utils.fmt_money(row.balance, currency=filters.presentation_currency) }}
                </td>
            {% endif %}
        </tr>
        {% endfor %}
    </tbody>
</table>

{% if ageing %}
<table class="caw-soa-table caw-soa-ageing">
    <thead>
        <tr>
            <th>Current</th>
            <th>1-30 Days Past Due</th>
            <th>31-60 Days Past Due</th>
            <th>61-90 Days Past Due</th>
            <th>Over 90 Days Past Due</th>
            <th>Amount Due</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>{{ frappe.utils.fmt_money(ageing.current, currency=filters.presentation_currency) }}</td>
            <td>{{ frappe.utils.fmt_money(ageing.range1, currency=filters.presentation_currency) }}</td>
            <td>{{ frappe.utils.fmt_money(ageing.range2, currency=filters.presentation_currency) }}</td>
            <td>{{ frappe.utils.fmt_money(ageing.range3, currency=filters.presentation_currency) }}</td>
            <td>{{ frappe.utils.fmt_money(ageing.range4, currency=filters.presentation_currency) }}</td>
            <td><b>{{ frappe.utils.fmt_money(ageing.total_due, currency=filters.presentation_currency) }}</b></td>
        </tr>
    </tbody>
</table>
{% endif %}

{% if terms_and_conditions %}
<div style="margin-top: 15px; font-size: 11px; color: #495057;">
    {{ terms_and_conditions }}
</div>
{% endif %}
"""


def create_crystal_statement_print_format():
    """Store the statement layout on its Print Format (a General Ledger report format, not a
    doctype one, so it doesn't go through create_crystal_print_format)."""
    html = embed_letterhead_image(build_crystal_statement_print_format_html())
    if frappe.db.exists("Print Format", STATEMENT_PRINT_FORMAT_NAME):
        doc = frappe.get_doc("Print Format", STATEMENT_PRINT_FORMAT_NAME)
        doc.html = html
    else:
        doc = frappe.get_doc({
            "doctype": "Print Format",
            "name": STATEMENT_PRINT_FORMAT_NAME,
            "module": "Accounts",
            "print_format_for": "Report",
            "report": "General Ledger",
            "print_format_type": "Jinja",
            "custom_format": 1,
            "standard": "No",
            "html": html,
        })
    previous_in_migrate = frappe.flags.in_migrate
    frappe.flags.in_migrate = True
    try:
        if doc.is_new():
            doc.insert(ignore_permissions=True)
        else:
            doc.save(ignore_permissions=True)
    finally:
        frappe.flags.in_migrate = previous_in_migrate
    frappe.db.commit()
    print(f"Print Format '{STATEMENT_PRINT_FORMAT_NAME}' updated successfully.")


def create_crystal_print_format(doctype, print_format_name, ref_label=None, terms=None, payment_details=""):
    context = get_print_format_context(print_format_name)
    ref_label = ref_label or context.get("ref_label")
    terms = terms or context.get("terms")
    payment_details = payment_details or context.get("payment_details") or ""
    if print_format_name == "Crystal Job Card":
        html = build_crystal_job_card_print_format_html()
    else:
        html = build_crystal_print_format_html(ref_label, terms, payment_details)

    html = embed_letterhead_image(html)

    # Print Format.validate() refuses to touch a standard=Yes format outside
    # developer_mode (frappe/printing/doctype/print_format/print_format.py) — fine for
    # a stray manual edit via the Print Format Builder, but this regenerates the exact
    # same standard format's HTML from Print Format Configurations' own saved values, a
    # fully code-controlled rebuild, not an ad hoc customisation. developer_mode is (and
    # should stay) off outside local dev, so without this the Configurations page's Save
    # throws "Standard Print Format cannot be updated" everywhere but there. in_migrate
    # is the same flag Frappe's own standard-doc fixture sync relies on to bypass this.
    previous_in_migrate = frappe.flags.in_migrate
    frappe.flags.in_migrate = True
    try:
        if not frappe.db.exists("Print Format", print_format_name):
            doc = frappe.get_doc({
                "doctype": "Print Format",
                "name": print_format_name,
                "doc_type": doctype,
                "custom_format": 1,
                "format_data": "",
                "html": html,
                "print_format_builder": 0,
                "standard": "Yes", # Treat as Standard in our App
                "show_section_headings": 0,
                "line_breaks": 0,
                "align_labels_right": 0
            })
            doc.insert(ignore_permissions=True)
        else:
            doc = frappe.get_doc("Print Format", print_format_name)
            doc.html = html
            doc.save(ignore_permissions=True)
    finally:
        frappe.flags.in_migrate = previous_in_migrate

    frappe.db.commit()
    print(f"Print Format '{print_format_name}' updated successfully.")

def setup_formats():
    create_crystal_print_format(
        doctype="Quotation",
        print_format_name="Crystal Quotation",
    )
    
    create_crystal_print_format(
        doctype="Sales Order",
        print_format_name="Crystal Sales Order",
    )

    create_crystal_print_format(
        doctype="Sales Invoice",
        print_format_name="Crystal Sales Invoice",
    )

    create_crystal_print_format(
        doctype="Sales Invoice",
        print_format_name="Crystal Credit Note",
    )

    create_crystal_print_format(
        doctype="CAW Job Card",
        print_format_name="Crystal Job Card",
    )

    create_crystal_statement_print_format()

    ensure_default_print_format_configurations()

if __name__ == "__main__":
    setup_formats()
