import { google } from "googleapis";

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Google service account credentials are missing.");
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function spreadsheetId() {
  if (!process.env.GOOGLE_SHEETS_ID) {
    throw new Error("GOOGLE_SHEETS_ID is missing.");
  }

  return process.env.GOOGLE_SHEETS_ID;
}

const SALES_HEADERS = [
  "Reference",
  "Submission time",
  "Salesperson",
  "Customer",
  "Project",
  "Description",
  "Amount",
  "Proposed Richard %",
  "Proposed Anastasia %",
  "Proposed Jean-Claude %",
  "Approved Richard %",
  "Approved Anastasia %",
  "Approved Jean-Claude %",
  "Richard commission",
  "Anastasia commission",
  "Jean-Claude commission",
  "Status",
];

const EXPENSE_HEADERS = [
  "Reference",
  "Submission time",
  "Reporter",
  "Description",
  "Category",
  "Amount",
  "Proposed allocation",
  "Final allocation",
  "Status",
];

async function ensureTabsAndHeaders(sheets) {
  const id = spreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
  });

  const titles =
    meta.data.sheets?.map((sheet) => sheet.properties?.title) || [];

  const requests = [];

  if (!titles.includes("Sales")) {
    requests.push({
      addSheet: {
        properties: {
          title: "Sales",
        },
      },
    });
  }

  if (!titles.includes("Expenses")) {
    requests.push({
      addSheet: {
        properties: {
          title: "Expenses",
        },
      },
    });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests,
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: "Sales!A1:Q1",
    valueInputOption: "RAW",
    requestBody: {
      values: [SALES_HEADERS],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: "Expenses!A1:I1",
    valueInputOption: "RAW",
    requestBody: {
      values: [EXPENSE_HEADERS],
    },
  });
}

async function upsertRow(tab, values) {
  const sheets = google.sheets({
    version: "v4",
    auth: auth(),
  });

  await ensureTabsAndHeaders(sheets);

  const id = spreadsheetId();
  const lastCol = tab === "Sales" ? "Q" : "I";
  const ref = String(values[0]).trim();

  // Read rows without flattening them.
  // This preserves the real Google Sheets row numbers.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A2:A1000`,
  });

  const rows = existing.data.values || [];

  // Find the real row containing this reference.
  const existingIndex = rows.findIndex(
    (row) => String(row?.[0] || "").trim() === ref
  );

  let targetRow;

  if (existingIndex >= 0) {
    // A2 corresponds to index 0.
    targetRow = existingIndex + 2;
  } else {
    // Find the first genuinely empty row.
    const emptyIndex = rows.findIndex(
      (row) => !String(row?.[0] || "").trim()
    );

    if (emptyIndex >= 0) {
      targetRow = emptyIndex + 2;
    } else {
      // If all returned rows contain data, use the next row.
      targetRow = rows.length + 2;
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tab}!A${targetRow}:${lastCol}${targetRow}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [values],
    },
  });

  return {
    reference: ref,
    row: targetRow,
  };
}

export async function syncSale(sale) {
  return upsertRow("Sales", [
    sale.reference,
    sale.submitted_at,
    sale.salesperson,
    sale.customer,
    sale.project,
    sale.description,
    Number(sale.amount),
    Number(sale.proposed_richard_pct),
    Number(sale.proposed_anastasia_pct),
    Number(sale.proposed_jean_claude_pct),
    sale.approved_richard_pct ?? "",
    sale.approved_anastasia_pct ?? "",
    sale.approved_jean_claude_pct ?? "",
    Number(sale.richard_commission || 0),
    Number(sale.anastasia_commission || 0),
    Number(sale.jean_claude_commission || 0),
    sale.status,
  ]);
}

export async function syncExpense(expense) {
  return upsertRow("Expenses", [
    expense.reference,
    expense.submitted_at,
    expense.reporter,
    expense.description,
    expense.category,
    Number(expense.amount),
    expense.proposed_allocation,
    expense.final_allocation ?? "",
    expense.status,
  ]);
}
