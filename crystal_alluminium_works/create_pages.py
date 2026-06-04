import frappe

def create_pages():
    frappe.flags.in_install = True
    
    pages = [
        {
            "page_name": "crystal-aluminium-wo",
            "title": "Operations Dashboard",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "quotation-builder",
            "title": "Quotation Builder",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "quotations",
            "title": "Quotations",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "sales-invoices",
            "title": "Sales Invoices",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "cash-sales",
            "title": "Cash Sales",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "job-cards",
            "title": "Job Cards",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "job-card-detail",
            "title": "Job Card Detail",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        },
        {
            "page_name": "sales-invoice-manager",
            "title": "Sales Invoice Manager",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        }
    ]
    
    for p in pages:
        if not frappe.db.exists("Page", p["page_name"]):
            doc = frappe.get_doc({
                "doctype": "Page",
                "page_name": p["page_name"],
                "title": p["title"],
                "module": p["module"],
                "standard": p["standard"]
            })
            for r in p["roles"]:
                doc.append("roles", {"role": r["role"]})
            doc.insert()
            print(f"Created Page: {p['page_name']}")
            
    frappe.db.commit()

if __name__ == "__main__":
    create_pages()
