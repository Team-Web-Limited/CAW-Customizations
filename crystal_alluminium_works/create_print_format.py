import frappe

def build_crystal_print_format_html(ref_label, terms):
    html = f"""
{{% macro short_uom(value) %}}
    {{% set normalized = (value or '')|trim|lower %}}
    {{% if normalized == 'square foot' %}}sft
    {{% elif normalized == 'square meter' %}}sqm
    {{% elif normalized in ['meter', 'metre'] %}}m
    {{% elif normalized in ['running foot', 'rft'] %}}rft
    {{% elif normalized == 'nos' %}}nos
    {{% else %}}{{{{ value or '-' }}}}{{% endif %}}
{{% endmacro %}}

<div class="letterhead" style="margin-bottom: 20px;">
    <div style="font-size: 28px; font-weight: bold; color: #2c3e50; text-transform: uppercase;">Crystal Aluminium Works</div>
    <div style="color: #7f8c8d; font-size: 13px;">Specialists in Aluminium, Laminated Glass, and Acoustic Ceilings</div>
</div>
<hr style="border-top: 2px solid #ecf0f1; margin-bottom: 20px;">
<div class="row" style="margin-bottom: 30px;">
    <div class="col-xs-6">
        <div style="color: #7f8c8d; font-size: 12px; text-transform: uppercase;">Customer Name:</div>
        <div style="font-size: 16px; font-weight: bold;">{{{{ doc.customer_name or doc.party_name or doc.customer }}}}</div>
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

{{% set has_aluminium_rows = namespace(value=false) %}}
{{% set has_glass_rows = namespace(value=false) %}}
{{% for row in doc.items %}}
    {{% if not row.custom_auto_generated and (row.custom_product_category or '') == 'Aluminium' %}}
        {{% set has_aluminium_rows.value = true %}}
    {{% endif %}}
    {{% if not row.custom_auto_generated and (row.custom_product_category or '') == 'Glass' %}}
        {{% set has_glass_rows.value = true %}}
    {{% endif %}}
{{% endfor %}}

<table class="cq-table">
    <thead>
        <tr>
            <th style="text-align: left; white-space: nowrap;">Code</th>
            <th style="text-align: left; white-space: nowrap;">Item</th>
            {{% if has_aluminium_rows.value %}}
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
            {{% if not parent.custom_auto_generated %}}
                {{% set parent_category = parent.custom_product_category or '' %}}
                {{% set pieces = parent.qty or 0 %}}
                {{% set qty = parent.qty or 0 %}}
                {{% set uom = parent.uom or '' %}}
                {{% if parent_category == 'Aluminium' %}}
                    {{% set qty = parent.custom_aluminium_metres or 0 %}}
                    {{% set uom = parent.uom or 'Meter' %}}
                {{% elif parent_category == 'Ceiling' %}}
                    {{% set qty = parent.custom_ceiling_sq_m or 0 %}}
                    {{% set uom = parent.uom or 'Square Meter' %}}
                {{% elif parent_category == 'Glass' %}}
                    {{% if parent.custom_glass_sale_mode == 'Full Sheet' %}}
                        {{% set qty = parent.qty or 0 %}}
                        {{% set uom = 'Nos' %}}
                    {{% elif parent.custom_glass_sale_mode == 'Sheet' %}}
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
                    {{% if parent.custom_glass_sale_mode not in ['Full Sheet', 'Sheet'] and frappe.utils.flt(parent.custom_area_sqft or 0) %}}
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
                    {{% if has_aluminium_rows.value %}}
                    <td style="text-align: center; white-space: nowrap;">
                        {{% if parent_category == 'Aluminium' %}}
                            {{{{ parent.custom_aluminium_color or '-' }}}}
                        {{% else %}}-{{% endif %}}
                    </td>
                    {{% endif %}}
                    <td style="text-align: center; white-space: nowrap;">{{{{ frappe.utils.flt(pieces, 2) }}}}</td>
                    <td style="text-align: right; white-space: nowrap;">{{{{ frappe.format_value(display_rate, df={{'fieldtype': 'Currency'}}, doc=doc) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ frappe.utils.flt(qty, 3) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ short_uom(uom) }}}}</td>
                    <td style="text-align: center; white-space: nowrap;">{{{{ parent.idx or '-' }}}}</td>
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
            <td colspan="{{{{ 3 if has_aluminium_rows.value else 2 }}}}" style="border-bottom: 1px solid #dee2e6;">&nbsp;</td>
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

{{% set subtotal_amount = frappe.utils.flt(doc.grand_total or 0) %}}
{{% set vat_amount = subtotal_amount * 0.16 %}}
{{% set total_amount = subtotal_amount + vat_amount %}}
{{% set outstanding_display_amount = (frappe.utils.flt(doc.outstanding_amount or 0) * 1.16) if doc.doctype == 'Sales Invoice' and frappe.utils.flt(doc.total_taxes_and_charges or 0) == 0 else frappe.utils.flt(doc.outstanding_amount or 0) %}}
{{% set paid_display_amount = 0 %}}
{{% if doc.doctype == 'Sales Invoice' and (doc.status == 'Unpaid' or doc.status == 'Overdue') %}}
    {{% set outstanding_display_amount = total_amount %}}
{{% elif doc.doctype == 'Sales Invoice' %}}
    {{% set paid_display_amount = frappe.utils.flt(total_amount - outstanding_display_amount) %}}
    {{% if paid_display_amount > -0.5 and paid_display_amount < 0.5 %}}
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


def create_crystal_print_format(doctype, print_format_name, ref_label, terms):
    html = build_crystal_print_format_html(ref_label, terms)

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
        ref_label="Quotation Reference",
        terms="1. Quotation valid for 14 days from date of issue.<br>2. 60% advance payment required to commence production.<br>3. Delivery times to be confirmed upon receipt of advance."
    )
    
    create_crystal_print_format(
        doctype="Sales Order",
        print_format_name="Crystal Sales Order",
        ref_label="Order Reference",
        terms="1. Order confirmed and locked.<br>2. Production begins upon receipt of 60% advance payment.<br>3. Final 40% due upon delivery."
    )

    create_crystal_print_format(
        doctype="Sales Invoice",
        print_format_name="Crystal Sales Invoice",
        ref_label="Invoice Number",
        terms="1. Payment is due within the stipulated time frame.<br>2. Goods remain the property of Crystal Aluminium Works until fully paid for.<br>3. Any discrepancies must be reported within 3 days of delivery."
    )

if __name__ == "__main__":
    setup_formats()
