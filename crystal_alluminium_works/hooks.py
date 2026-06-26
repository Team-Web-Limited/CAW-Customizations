app_name = "crystal_alluminium_works"
app_title = "Crystal Alluminium Works"
app_publisher = "Venum"
app_description = "Crystal Alluminium Works App"
app_email = "admin@example.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []
fixtures = [
	# Workspace commented out — replaced by custom Page
	# {"dt": "Workspace", "filters": [["name", "in", ["Crystal Alluminium Works"]]]},
	{"dt": "Desktop Icon", "filters": [["name", "in", ["Crystal Alluminium Works"]]]},
	{"dt": "Custom Field", "filters": [["module", "in", ["Crystal Alluminium Works"]]]}
]

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "crystal_alluminium_works",
		"logo": "/assets/crystal_alluminium_works/images/crystal-alluminium-works-logo.png",
		"title": "Crystal Alluminium Works",
		"route": "/app/crystal-aluminium-wo",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/crystal_alluminium_works/css/crystal_alluminium_works.css"
app_include_js = "/assets/crystal_alluminium_works/js/workspace_sidebar_accordion.js"

# include js, css files in header of web template
# web_include_css = "/assets/crystal_alluminium_works/css/crystal_alluminium_works.css"
# web_include_js = "/assets/crystal_alluminium_works/js/crystal_alluminium_works.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "crystal_alluminium_works/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Quotation" : "public/js/quotation.js",
	"Sales Order" : "public/js/sales_order.js",
	"Sales Invoice" : "public/js/sales_invoice.js"
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "crystal_alluminium_works/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "crystal_alluminium_works.utils.jinja_methods",
# 	"filters": "crystal_alluminium_works.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "crystal_alluminium_works.install.before_install"
after_install = "crystal_alluminium_works.patches.refresh_workspace_sidebar_links.execute"

# Uninstallation
# ------------

# before_uninstall = "crystal_alluminium_works.uninstall.before_uninstall"
# after_uninstall = "crystal_alluminium_works.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "crystal_alluminium_works.utils.before_app_install"
# after_app_install = "crystal_alluminium_works.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "crystal_alluminium_works.utils.before_app_uninstall"
# after_app_uninstall = "crystal_alluminium_works.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "crystal_alluminium_works.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "crystal_alluminium_works.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Quotation": {
		"validate": "crystal_alluminium_works.quotation_handler.on_validate",
		"on_submit": "crystal_alluminium_works.quotation_handler.on_submit"
	},
	"Sales Order": {
		"validate": "crystal_alluminium_works.sales_order_handler.on_validate"
	},
	"Sales Invoice": {
		"validate": "crystal_alluminium_works.sales_invoice_handler.on_validate",
		"on_submit": "crystal_alluminium_works.api.on_sales_invoice_submit"
	}
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"crystal_alluminium_works.tasks.all"
# 	],
# 	"daily": [
# 		"crystal_alluminium_works.tasks.daily"
# 	],
# 	"hourly": [
# 		"crystal_alluminium_works.tasks.hourly"
# 	],
# 	"weekly": [
# 		"crystal_alluminium_works.tasks.weekly"
# 	],
# 	"monthly": [
# 		"crystal_alluminium_works.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "crystal_alluminium_works.install.before_tests"

after_migrate = "crystal_alluminium_works.patches.refresh_workspace_sidebar_links.execute"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "crystal_alluminium_works.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "crystal_alluminium_works.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "crystal_alluminium_works.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["crystal_alluminium_works.utils.before_request"]
# after_request = ["crystal_alluminium_works.utils.after_request"]

# Job Events
# ----------
# before_job = ["crystal_alluminium_works.utils.before_job"]
# after_job = ["crystal_alluminium_works.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"crystal_alluminium_works.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []
