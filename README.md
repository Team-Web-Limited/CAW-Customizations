### Crystal Alluminium Works

Crystal Alluminium Works App

### Guides

- [Foreign Currency: FIFO Cost Basis and Month-End Revaluation](FOREX_FIFO_AND_REVALUATION.md) —
  how USD holdings are costed, and the month-end revaluation steps
- [Sales Invoice: Cancel, Credit Note/Return, and Amend](INVOICE_AMENDMENT_GUIDE.md) —
  picking the right correction tool

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch version-16
bench install-app crystal_alluminium_works
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/crystal_alluminium_works
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
