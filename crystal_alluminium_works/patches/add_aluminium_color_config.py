from crystal_alluminium_works.create_custom_fields import add_custom_fields
from crystal_alluminium_works.create_doctypes import create_doctypes


def execute():
    create_doctypes()
    add_custom_fields()
