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

<div class="letterhead" style="margin-bottom: 20px;">
    <img src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg" style="max-width: 100%; height: auto;" alt="Crystal Aluminium Works">
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">
<div class="row" style="margin-bottom: 30px;">
    <div class="col-xs-6">
        <!-- Cash quotations all share the one walk-in Customer record, so customer_name/
             party_name is always "Cash Customer" - custom_customer_name (Quotation only,
             captured in Quotation Builder's cash-mode step) carries the walk-in's own name. -->
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Customer Name:</div>
        <div style="font-size: 16px; font-weight: bold;">{{{{ doc.get('custom_customer_name') or doc.customer_name or doc.party_name or doc.customer }}}}</div>
    </div>
    <div class="col-xs-6 text-right">
        {{% if doc.doctype == 'Sales Invoice' %}}
        <div style="font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Invoice</div>
        {{% endif %}}
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Date:</div>
        <div style="font-size: 16px; font-weight: bold;">{{{{ frappe.utils.formatdate(doc.posting_date or doc.transaction_date) }}}}</div>
        {{% if doc.doctype != 'Sales Invoice' and doc.due_date %}}
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 5px;">Due Date:</div>
        <div style="font-size: 14px; font-weight: bold; color: #e74c3c;">{{{{ frappe.utils.formatdate(doc.due_date) }}}}</div>
        {{% endif %}}
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase; margin-top: 10px;">{ref_label}:</div>
        <div style="font-size: 14px;">{{{{ doc.name }}}}</div>
    </div>
</div>

<style>
    .cq-table {{
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }}
    .cq-table th {{
        background-color: #f8f9fa;
        color: #2c3e50;
        padding: 6px 4px;
        border-bottom: 2px solid #dee2e6;
        font-size: 10px;
    }}
    .cq-table td {{
        padding: 6px 4px;
        border-bottom: 1px solid #dee2e6;
        vertical-align: middle;
        font-size: 10px;
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

{{% set has_color_rows = namespace(value=false) %}}
{{% set has_glass_rows = namespace(value=false) %}}
{{% set has_non_ceiling_parent = namespace(value=false) %}}
{{% set has_ceiling_parent = namespace(value=false) %}}
{{% set has_ceiling_bundle = namespace(value=false) %}}
{{% set ceiling_single_labels = namespace(items=[]) %}}
{{% set ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'] %}}
{{% set ceiling_board_item_codes = frappe.call("crystal_alluminium_works.api.get_ceiling_board_item_codes") %}}
{{% for row in doc.items %}}
    {{% if not row.custom_auto_generated and (row.custom_aluminium_color or '')|trim %}}
        {{% set has_color_rows.value = true %}}
    {{% endif %}}
    {{% if not row.custom_auto_generated and (row.custom_product_category or '') == 'Glass' %}}
        {{% set has_glass_rows.value = true %}}
    {{% endif %}}
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
        {{% else %}}
            {{% set has_non_ceiling_parent.value = true %}}
        {{% endif %}}
    {{% endif %}}
{{% endfor %}}

{{% if has_non_ceiling_parent.value %}}
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {{% if has_color_rows.value %}}
            <th style="text-align: center; white-space: nowrap;">Color</th>
            {{% endif %}}
            <th style="text-align: center; white-space: nowrap;">Pcs</th>
            <th style="text-align: right; white-space: nowrap;">Rate</th>
            <th style="text-align: center; white-space: nowrap;">Qty</th>
            <th style="text-align: center; white-space: nowrap;">UOM</th>
            <th style="text-align: center; white-space: nowrap;">No</th>
            {{% if has_glass_rows.value %}}
            <th style="text-align: center; white-space: nowrap;">Width</th>
            <th style="text-align: center; white-space: nowrap;">Height</th>
            <th style="text-align: left; white-space: nowrap;">Polish Sides</th>
            <th style="text-align: center; white-space: nowrap;">Holes</th>
            <th style="text-align: center; white-space: nowrap;">Notches</th>
            {{% endif %}}
            <th style="text-align: right; white-space: nowrap;">Amount</th>
        </tr>
    </thead>
    <tbody>
        {{% set quotation_totals = namespace(pcs=0, qty=0, holes=0, notches=0) %}}
        {{% for parent in doc.items %}}
            {{% if not parent.custom_auto_generated and (parent.custom_product_category or '') != 'Ceiling' %}}
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
                {{% set quotation_totals.pcs = quotation_totals.pcs + frappe.utils.flt(pieces, 2) %}}
                {{% set quotation_totals.qty = quotation_totals.qty + frappe.utils.flt(qty, 3) %}}
                {{% set quotation_totals.holes = quotation_totals.holes + frappe.utils.cint(parent.custom_holes or 0) %}}
                {{% set quotation_totals.notches = quotation_totals.notches + frappe.utils.cint(parent.custom_notches or 0) %}}
                {{% set width_sides = frappe.utils.cint(parent.custom_polish_width_sides or 0) %}}
                {{% set height_sides = frappe.utils.cint(parent.custom_polish_height_sides or 0) %}}
                {{% if parent_category == 'Glass' and not width_sides and not height_sides and frappe.utils.cint(parent.custom_polishing or 0) %}}
                    {{% set width_sides = 2 %}}
                    {{% set height_sides = 2 %}}
                {{% endif %}}
                {{% set polish_sides = width_sides + height_sides %}}
                {{% set glass_service = namespace(polish_amount=0, holes_amount=0, notches_amount=0) %}}
                {{% set display_width = '-' %}}
                {{% set display_height = '-' %}}
                {{% set display_rate = parent.rate or 0 %}}
                {{% if parent_category == 'Glass' %}}
                    {{% set display_width = frappe.utils.flt(parent.custom_width_mm or 0, 0) or '-' %}}
                    {{% set display_height = frappe.utils.flt(parent.custom_height_mm or 0, 0) or '-' %}}
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
                    <td>{{{{ parent.item_name or parent.item_code or '' }}}}</td>
                    {{% if has_color_rows.value %}}
                    <td style="text-align: center; white-space: nowrap;">
                        {{{{ parent.custom_aluminium_color or '-' }}}}
                    </td>
                    {{% endif %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ frappe.utils.flt(pieces, 2) }}}}</td>
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(display_rate, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ frappe.utils.flt(qty, 3) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ short_uom(uom) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if parent_category == 'Glass' %}}{{{{ parent.custom_numbering or '-' }}}}{{% else %}}-{{% endif %}}
                    </td>
                    {{% if has_glass_rows.value %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ display_width }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ display_height }}}}</td>
                    <td style="white-space: nowrap;">
                        {{% if parent_category == 'Glass' and polish_sides > 0 %}}
                            {{{{ polish_sides }}}}
                            {{% if glass_service.polish_amount %}} ({{{{ frappe.format_value(glass_service.polish_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}){{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if parent_category == 'Glass' and frappe.utils.cint(parent.custom_holes or 0) > 0 %}}
                            {{{{ frappe.utils.cint(parent.custom_holes or 0) }}}}
                            {{% if glass_service.holes_amount %}} ({{{{ frappe.format_value(glass_service.holes_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}){{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if parent_category == 'Glass' and frappe.utils.cint(parent.custom_notches or 0) > 0 %}}
                            {{{{ frappe.utils.cint(parent.custom_notches or 0) }}}}
                            {{% if glass_service.notches_amount %}} ({{{{ frappe.format_value(glass_service.notches_amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}){{% endif %}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    {{% endif %}}
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(line.amount, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                </tr>
            {{% endif %}}
        {{% endfor %}}
        {{% if doc.doctype == 'Quotation' %}}
        <tr>
            <td colspan="{{{{ 3 if has_color_rows.value else 2 }}}}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ frappe.utils.flt(quotation_totals.pcs, 2) }}}}</td>
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ frappe.utils.flt(quotation_totals.qty, 3) }}}}</td>
            {{% if has_glass_rows.value %}}
            <td colspan="5" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ quotation_totals.holes }}}}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{{{ quotation_totals.notches }}}}</td>
            {{% else %}}
            <td colspan="2" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {{% endif %}}
            <td style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
        </tr>
        {{% endif %}}
    </tbody>
</table>
{{% endif %}}

{{% if has_ceiling_parent.value %}}
{{% set ceiling_columns = ceiling_component_labels if has_ceiling_bundle.value else ceiling_single_labels.items %}}
<div style="margin: 10px 0 8px 0; font-size: 13px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">Ceiling Items</div>
<table class="cq-table">
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
    </tbody>
</table>
{{% endif %}}

{{% set subtotal_amount = frappe.utils.flt(doc.grand_total or 0) %}}
{{% set vat_amount = subtotal_amount * 0.16 %}}
{{% set total_amount = subtotal_amount + vat_amount %}}
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
        <div style="padding: 15px; background: #f8f9fa; border-radius: 4px;">
            <div style="font-size: 12px; color: #6c757d; margin-bottom: 5px;">Terms & Conditions</div>
            <div style="font-size: 11px; color: #495057;">
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
"""

    return html


def build_crystal_payment_receipt_print_format_html():
    return """
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
    return """
{% set job_card = doc %}
{% set quotation = frappe.get_doc('Quotation', job_card.quotation) if job_card.quotation else None %}
{% set print_items = quotation.items if quotation else [] %}

{% macro short_uom(value) %}
    {% set normalized = (value or '')|trim|lower %}
    {% if normalized == 'square foot' %}sft
    {% elif normalized == 'square meter' %}sqm
    {% elif normalized in ['meter', 'metre', 'len'] %}len
    {% elif normalized in ['running foot', 'rft'] %}rft
    {% elif normalized == 'nos' %}nos
    {% else %}{{ value or '-' }}{% endif %}
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
                <div style="font-size: 26px; font-weight: bold; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Job Card</div>
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
        font-size: 10px;
    }
    .cq-table td {
        padding: 6px 4px;
        border-bottom: 1px solid #dee2e6;
        vertical-align: middle;
        font-size: 10px;
    }
    .jc-section {
        padding: 14px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 11px;
        color: #495057;
    }
</style>

{% set has_color_rows = namespace(value=false) %}
{% set has_glass_rows = namespace(value=false) %}
{% set has_non_ceiling_parent = namespace(value=false) %}
{% set has_ceiling_parent = namespace(value=false) %}
{% set has_ceiling_bundle = namespace(value=false) %}
{% set ceiling_single_labels = namespace(items=[]) %}
{% set ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'] %}
{% set ceiling_board_item_codes = frappe.call("crystal_alluminium_works.api.get_ceiling_board_item_codes") %}
{% for row in print_items %}
    {% if not row.custom_auto_generated and (row.custom_aluminium_color or '')|trim %}
        {% set has_color_rows.value = true %}
    {% endif %}
    {% if not row.custom_auto_generated and (row.custom_product_category or '') == 'Glass' %}
        {% set has_glass_rows.value = true %}
    {% endif %}
    {% if not row.custom_auto_generated %}
        {% set row_category = row.custom_product_category or '' %}
        {% if row_category == 'Ceiling' %}
            {% set has_ceiling_parent.value = true %}
            {% if frappe.utils.flt(row.custom_ceiling_sq_m or 0) > 0 %}
                {% set has_ceiling_bundle.value = true %}
            {% else %}
                {% set single_label = 'Board' if row.item_code in ceiling_board_item_codes else (row.item_name or row.item_code or '') %}
                {% if single_label and single_label not in ceiling_single_labels.items %}
                    {% set ceiling_single_labels.items = ceiling_single_labels.items + [single_label] %}
                {% endif %}
            {% endif %}
        {% else %}
            {% set has_non_ceiling_parent.value = true %}
        {% endif %}
    {% endif %}
{% endfor %}

{% if has_non_ceiling_parent.value %}
<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {% if has_color_rows.value %}
            <th style="text-align: center; white-space: nowrap;">Color</th>
            {% endif %}
            <th style="text-align: center; white-space: nowrap;">Pcs</th>
            <th style="text-align: center; white-space: nowrap;">Qty</th>
            <th style="text-align: center; white-space: nowrap;">UOM</th>
            <th style="text-align: center; white-space: nowrap;">No</th>
            {% if has_glass_rows.value %}
            <th style="text-align: center; white-space: nowrap;">Width</th>
            <th style="text-align: center; white-space: nowrap;">Height</th>
            <th style="text-align: center; white-space: nowrap;">Polish Sides</th>
            <th style="text-align: center; white-space: nowrap;">Holes</th>
            <th style="text-align: center; white-space: nowrap;">Notches</th>
            {% endif %}
        </tr>
    </thead>
    <tbody>
        {% set job_totals = namespace(pcs=0, qty=0, holes=0, notches=0) %}
        {% for parent in print_items %}
            {% if not parent.custom_auto_generated and (parent.custom_product_category or '') != 'Ceiling' %}
                {% set parent_category = parent.custom_product_category or '' %}
                {% set pieces = parent.qty or 0 %}
                {% set qty = parent.qty or 0 %}
                {% set uom = parent.uom or '' %}
                {% if parent_category == 'Aluminium' %}
                    {% set qty = parent.qty or 0 %}
                    {% set uom = parent.uom or 'Nos' %}
                {% elif parent_category == 'Glass' %}
                    {% if parent.custom_glass_sale_mode == 'Full Sheet' %}
                        {% set qty = parent.qty or 0 %}
                        {% set uom = 'Nos' %}
                    {% elif parent.custom_glass_sale_mode == 'Sheet' %}
                        {% set pieces = parent.custom_sheet_pcs or 0 %}
                        {% set qty = parent.qty or 0 %}
                        {% set uom = parent.uom or 'Square Foot' %}
                    {% else %}
                        {% set qty = (parent.custom_area_sqft or 0) * (parent.qty or 0) %}
                        {% set uom = parent.uom or 'Square Foot' %}
                    {% endif %}
                {% endif %}
                {% set job_totals.pcs = job_totals.pcs + frappe.utils.flt(pieces, 2) %}
                {% set job_totals.qty = job_totals.qty + frappe.utils.flt(qty, 3) %}
                {% set job_totals.holes = job_totals.holes + frappe.utils.cint(parent.custom_holes or 0) %}
                {% set job_totals.notches = job_totals.notches + frappe.utils.cint(parent.custom_notches or 0) %}
                {% set width_sides = frappe.utils.cint(parent.custom_polish_width_sides or 0) %}
                {% set height_sides = frappe.utils.cint(parent.custom_polish_height_sides or 0) %}
                {% if parent_category == 'Glass' and not width_sides and not height_sides and frappe.utils.cint(parent.custom_polishing or 0) %}
                    {% set width_sides = 2 %}
                    {% set height_sides = 2 %}
                {% endif %}
                {% set polish_sides = width_sides + height_sides %}
                {% set display_width = '-' %}
                {% set display_height = '-' %}
                {% if parent_category == 'Glass' %}
                    {% set display_width = frappe.utils.flt(parent.custom_width_mm or 0, 0) or '-' %}
                    {% set display_height = frappe.utils.flt(parent.custom_height_mm or 0, 0) or '-' %}
                {% endif %}
                <tr>
                    <td style="font-weight: bold; white-space: nowrap;">{{ parent.item_code or '' }}</td>
                    <td>{{ parent.item_name or parent.item_code or '' }}</td>
                    {% if has_color_rows.value %}
                    <td style="text-align: center; white-space: nowrap;">{{ parent.custom_aluminium_color or '-' }}</td>
                    {% endif %}
                    <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(pieces, 2) }}</td>
                    <td style="text-align: center; white-space: nowrap;">{{ frappe.utils.flt(qty, 3) }}</td>
                    <td style="text-align: center; white-space: nowrap;">{{ short_uom(uom) }}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        {% if parent_category == 'Glass' %}{{ parent.custom_numbering or '-' }}{% else %}-{% endif %}
                    </td>
                    {% if has_glass_rows.value %}
                    <td style="text-align: center; white-space: nowrap;">{{ display_width }}</td>
                    <td style="text-align: center; white-space: nowrap;">{{ display_height }}</td>
                    <td style="text-align: center; white-space: nowrap;">{% if parent_category == 'Glass' and polish_sides > 0 %}{{ polish_sides }}{% else %}-{% endif %}</td>
                    <td style="text-align: center; white-space: nowrap;">{% if parent_category == 'Glass' and frappe.utils.cint(parent.custom_holes or 0) > 0 %}{{ frappe.utils.cint(parent.custom_holes or 0) }}{% else %}-{% endif %}</td>
                    <td style="text-align: center; white-space: nowrap;">{% if parent_category == 'Glass' and frappe.utils.cint(parent.custom_notches or 0) > 0 %}{{ frappe.utils.cint(parent.custom_notches or 0) }}{% else %}-{% endif %}</td>
                    {% endif %}
                </tr>
            {% endif %}
        {% endfor %}
        <tr>
            <td colspan="{{ 3 if has_color_rows.value else 2 }}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(job_totals.pcs, 2) }}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ frappe.utils.flt(job_totals.qty, 3) }}</td>
            {% if has_glass_rows.value %}
            <td colspan="5" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ job_totals.holes }}</td>
            <td style="text-align: center; white-space: nowrap; font-weight: bold;">{{ job_totals.notches }}</td>
            {% else %}
            <td colspan="2" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
            {% endif %}
        </tr>
    </tbody>
</table>
{% endif %}

{% if has_ceiling_parent.value %}
{% set ceiling_columns = ceiling_component_labels if has_ceiling_bundle.value else ceiling_single_labels.items %}
<div style="margin: 10px 0 8px 0; font-size: 13px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">Ceiling Items</div>
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
"""


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
        doctype="CAW Job Card",
        print_format_name="Crystal Job Card",
    )

    ensure_default_print_format_configurations()

if __name__ == "__main__":
    setup_formats()
