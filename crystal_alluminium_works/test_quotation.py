import frappe

def run_tests():
    frappe.flags.in_test = True
    frappe.flags.ignore_mandatory = True
    print("--- Running Test Cases ---")
    
    # Setup test quotation
    try:
        customer = frappe.get_doc({
            "doctype": "Customer",
            "customer_name": "Test Customer",
            "customer_group": "Commercial",
            "territory": "All Territories",
            "customer_type": "Company"
        }).insert(ignore_permissions=True)
    except frappe.exceptions.DuplicateEntryError:
        pass
        
    quo = frappe.get_doc({
        "doctype": "Quotation",
        "party_name": "Test Customer",
        "quotation_to": "Customer",
        "items": [
            {
                "item_code": "Ordinary Glass",
                "item_name": "Ordinary Glass",
                "uom": "Square Foot",
                "conversion_factor": 1.0,
                "qty": 1,
                "ordered_qty": 0.0,
                "custom_width_mm": 600,
                "custom_height_mm": 900,
                "custom_polishing": 1,
                "custom_holes": 2,
                "custom_sandblast_type": "Half"
            },
            {
                "item_code": "Acoustic Ceiling",
                "item_name": "Acoustic Ceiling",
                "uom": "Square Meter",
                "conversion_factor": 1.0,
                "ordered_qty": 0.0,
                "qty": 10
            },
            {
                "item_code": "Sample Aluminium Profile",
                "item_name": "Sample Aluminium Profile",
                "uom": "Meter",
                "conversion_factor": 1.0,
                "ordered_qty": 0.0,
                "qty": 3.6
            }
        ]
    })
    
    quo.save(ignore_permissions=True)
    
    # Test Case 1: Glass
    glass_items = [i for i in quo.items if getattr(i, "custom_auto_generated", 0) or i.item_code == "Ordinary Glass"]
    
    base_glass = next(i for i in glass_items if i.item_code == "Ordinary Glass")
    assert base_glass.custom_area_sqft == 6.0, f"Area sqft is {base_glass.custom_area_sqft}, expected 6.0"
    assert base_glass.custom_perimeter_rft == 10.0, f"Perimeter rft is {base_glass.custom_perimeter_rft}, expected 10.0"
    assert base_glass.amount == 540.0, f"Base glass amount is {base_glass.amount}, expected 540.0"
    
    polishing = next(i for i in glass_items if i.item_code == "Glass Polishing")
    assert polishing.amount == 200.0, f"Polishing amount is {polishing.amount}, expected 200.0"
    
    holes = next(i for i in glass_items if i.item_code == "Glass Hole Drilling")
    assert holes.amount == 50.0, f"Holes amount is {holes.amount}, expected 50.0"
    
    sandblast = next(i for i in glass_items if i.item_code == "Glass Sandblasting")
    assert sandblast.amount == 210.0, f"Sandblast amount is {sandblast.amount}, expected 210.0"
    
    print("✅ Test Case 1 (Glass) Passed: 600x900mm + processing = 1000")
    
    # Test Case 2: Ceiling
    ceiling = next(i for i in quo.items if i.item_code == "Acoustic Ceiling")
    assert ceiling.amount == 8000.0, f"Ceiling amount is {ceiling.amount}, expected 8000.0"
    
    print("✅ Test Case 2 (Ceiling) Passed: 10 sqm = 8000")
    
    # Test Case 3: Aluminium
    alu = next(i for i in quo.items if i.item_code == "Sample Aluminium Profile")
    assert alu.amount == 1800.0, f"Alu amount is {alu.amount}, expected 1800.0 (3.6 * 500)"
    
    print("✅ Test Case 3 (Aluminium) Passed: 3.6m * 500 = 1800")
    
    # Cleanup
    quo.delete()

if __name__ == "__main__":
    run_tests()
