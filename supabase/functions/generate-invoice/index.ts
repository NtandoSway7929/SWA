import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND = rgb(0 / 255, 32 / 255, 150 / 255);
const DARK = rgb(8 / 255, 21 / 255, 51 / 255);
const MUTED = rgb(86 / 255, 98 / 255, 122 / 255);
const LIGHT = rgb(247 / 255, 250 / 255, 255 / 255);
const BORDER = rgb(224 / 255, 230 / 255, 240 / 255);

interface InvoiceRequest {
  invoice_id?: string;
  action?: "pdf" | "send";
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

function money(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
) {
  const words = String(text || "").split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current
      ? current + " " + word
      : word;

    if (
      font.widthOfTextAtSize(
        candidate,
        size,
      ) <= maxWidth
    ) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        index,
        Math.min(
          index + chunkSize,
          bytes.length,
        ),
      ),
    );
  }

  return btoa(binary);
}

async function loadLogo() {
  try {
    const response = await fetch(
      "https://swayphics.co.za/swayphics-logo.png",
    );

    if (!response.ok) {
      return null;
    }

    return new Uint8Array(
      await response.arrayBuffer(),
    );
  } catch {
    return null;
  }
}

async function buildPdf(
  invoice: any,
  items: LineItem[],
  settings: any,
) {
  const pdfDoc = await PDFDocument.create();

  const regular =
    await pdfDoc.embedFont(
      StandardFonts.Helvetica,
    );

  const bold =
    await pdfDoc.embedFont(
      StandardFonts.HelveticaBold,
    );

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;

  const logoBytes = await loadLogo();

  let logo = null;

  if (logoBytes) {
    try {
      logo =
        await pdfDoc.embedPng(
          logoBytes,
        );
    } catch {
      logo = null;
    }
  }

  function drawWatermark(targetPage) {
    if (!logo) return;

    const maxWatermarkSize = 260;
    const watermarkScale = Math.min(
      maxWatermarkSize / logo.width,
      maxWatermarkSize / logo.height,
    );

    const watermarkWidth =
      logo.width * watermarkScale;

    const watermarkHeight =
      logo.height * watermarkScale;

    targetPage.drawImage(logo, {
      x:
        (pageWidth - watermarkWidth) / 2,
      y:
        (pageHeight - watermarkHeight) / 2,
      width: watermarkWidth,
      height: watermarkHeight,
      opacity: 0.075,
    });
  }

  let page = pdfDoc.addPage([
    pageWidth,
    pageHeight,
  ]);

  drawWatermark(page);

  let y = pageHeight - margin;

  if (logo) {
    const maxWidth = 145;
    const maxHeight = 55;
    const scale = Math.min(
      maxWidth / logo.width,
      maxHeight / logo.height,
    );

    page.drawImage(logo, {
      x: margin,
      y:
        y -
        logo.height *
          scale,
      width:
        logo.width *
        scale,
      height:
        logo.height *
        scale,
    });

    y -=
      logo.height *
        scale +
      24;
  } else {
    page.drawText(

      settings.business_name ||
        "SWAYPHICS",
      {
        x: margin,
        y,
        size: 24,
        font: bold,
        color: BRAND,
      },
    );

    y -= 34;
  }

  page.drawText(
    "INVOICE",
    {
      x:
        pageWidth -
        margin -
        bold.widthOfTextAtSize(
          "INVOICE",
          22,
        ),
      y:
        pageHeight -
        margin -
        8,
      size: 22,
      font: bold,
      color: BRAND,
    },
  );

  y -= 36;

  page.drawLine({
    start: {
      x: margin,
      y,
    },
    end: {
      x: pageWidth - margin,
      y,
    },
    thickness: 1.2,
    color: BORDER,
  });

  y -= 24;

  const rightX = 390;

  page.drawText(
    invoice.invoice_number,
    {
      x: rightX,
      y,
      size: 10,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "Issue date",
    {
      x: rightX,
      y: y - 18,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    shortDate(invoice.issue_date),
    {
      x: rightX + 70,
      y: y - 18,
      size: 7.5,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "Due date",
    {
      x: rightX,
      y: y - 34,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    shortDate(invoice.due_date),
    {
      x: rightX + 70,
      y: y - 34,
      size: 7.5,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "BILL TO",
    {
      x: margin,
      y,
      size: 7,
      font: bold,
      color: BRAND,
      characterSpacing: 1,
    },
  );

  page.drawText(
    invoice.client?.business_name ||
      "Client",
    {
      x: margin,
      y: y - 18,
      size: 13,
      font: bold,
      color: DARK,
    },
  );

  let clientY = y - 34;

  if (invoice.client?.contact_name) {
    page.drawText(
      invoice.client.contact_name,
      {
        x: margin,
        y: clientY,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    clientY -= 13;
  }

  if (invoice.client?.email) {
    page.drawText(
      invoice.client.email,
      {
        x: margin,
        y: clientY,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );
  }

  y -= 88;

  const tableTop = y;
  const colDescription = margin;
  const colQty = 390;
  const colPrice = 450;
  const colTotal = 515;

  page.drawRectangle({
    x: margin,
    y: tableTop - 21,
    width:
      pageWidth -
      margin * 2,
    height: 21,
    color: BRAND,
  });

  page.drawText(
    "DESCRIPTION",
    {
      x: colDescription + 8,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "QTY",
    {
      x: colQty,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "PRICE",
    {
      x: colPrice,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "TOTAL",
    {
      x: colTotal,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  y = tableTop - 36;

  for (const item of items) {
    const descriptionLines =
      wrapText(
        item.description,
        regular,
        8,
        320,
      );

    const rowHeight = Math.max(
      30,
      descriptionLines.length *
        11 +
        13,
    );

    if (y - rowHeight < 150) {
      page = pdfDoc.addPage([
        pageWidth,
        pageHeight,
      ]);

      drawWatermark(page);

      y = pageHeight - margin;

      page.drawText(
        invoice.invoice_number,
        {
          x: margin,
          y,
          size: 9,
          font: bold,
          color: BRAND,
        },
      );

      y -= 30;
    }

    if (
      Math.round(
        (tableTop - y) /
          30,
      ) %
        2 ===
      0
    ) {
      page.drawRectangle({
        x: margin,
        y:
          y -
          rowHeight +
          5,
        width:
          pageWidth -
          margin * 2,
        height: rowHeight,
        color: LIGHT,
      });
    }

    descriptionLines.forEach(
      (line, index) => {
        page.drawText(line, {
          x: colDescription + 8,
          y:
            y -
            index * 11,
          size: 8,
          font: regular,
          color: DARK,
        });
      },
    );

    page.drawText(
      String(item.quantity),
      {
        x: colQty,
        y:
          y -
          2,
        size: 8,
        font: regular,
        color: DARK,
      },
    );

    page.drawText(
      money(item.unit_price),
      {
        x: colPrice,
        y:
          y -
          2,
        size: 8,
        font: regular,
        color: DARK,
      },
    );

    page.drawText(
      money(item.line_total),
      {
        x: colTotal,
        y:
          y -
          2,
        size: 8,
        font: bold,
        color: DARK,
      },
    );

    page.drawLine({
      start: {
        x: margin,
        y:
          y -
          rowHeight +
          2,
      },
      end: {
        x:
          pageWidth -
          margin,
        y:
          y -
          rowHeight +
          2,
      },
      thickness: 0.5,
      color: BORDER,
    });

    y -= rowHeight;
  }

  y -= 22;

  const summaryX = 380;
  const valueX = 515;
  const totalRightX = pageWidth - margin - 12;

  page.drawText(
    "Subtotal",
    {
      x: summaryX,
      y,
      size: 8,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    money(invoice.subtotal),
    {
      x: valueX,
      y,
      size: 8,
      font: bold,
      color: DARK,
    },
  );

  if (Number(invoice.discount || 0) > 0) {
    y -= 17;

    page.drawText(
      "Discount",
      {
        x: summaryX,
        y,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    page.drawText(
      "-" +
        money(invoice.discount),
      {
        x: valueX,
        y,
        size: 8,
        font: bold,
        color: DARK,
      },
    );
  }

  if (Number(invoice.vat_amount || 0) > 0) {
    y -= 17;

    page.drawText(
      "VAT (" +
        Number(invoice.vat_rate || 0) +
        "%)",
      {
        x: summaryX,
        y,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    page.drawText(
      money(invoice.vat_amount),
      {
        x: valueX,
        y,
        size: 8,
        font: bold,
        color: DARK,
      },
    );
  }

  y -= 40;

  const totalBoxX = summaryX - 12;
  const totalBoxWidth =
    pageWidth -
    margin -
    totalBoxX;
  const totalBoxY = y - 10;
  const totalBoxHeight = 34;

  page.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: totalBoxWidth,
    height: totalBoxHeight,
    color: BRAND,
  });

  page.drawText(
    "TOTAL",
    {
      x: summaryX,
      y: y + 1,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  const totalAmount =
    money(invoice.total);

  page.drawText(
    totalAmount,
    {
      x:
        totalRightX -
        bold.widthOfTextAtSize(
          totalAmount,
          10,
        ),
      y: y + 1,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  y -= 62;

  const notes =
    invoice.notes ||
    "Thank you for choosing Swayphics.";

  page.drawText(
    "NOTES",
    {
      x: margin,
      y,
      size: 7,
      font: bold,
      color: BRAND,
      characterSpacing: 1,
    },
  );

  y -= 15;

  for (const line of wrapText(
    notes,
    regular,
    8,
    480,
  )) {
    page.drawText(line, {
      x: margin,
      y,
      size: 8,
      font: regular,
      color: MUTED,
    });

    y -= 11;
  }

  if (
    settings.payment_instructions ||
    settings.bank_name ||
    settings.account_number
  ) {
    y -= 12;

    page.drawText(
      "PAYMENT DETAILS",
      {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: BRAND,
        characterSpacing: 1,
      },
    );

    y -= 15;

    const paymentLines = [
      settings.bank_name
        ? "Bank: " +
          settings.bank_name
        : "",
      settings.account_name
        ? "Account holder: " +
          settings.account_name
        : "",
      settings.account_type
        ? "Account type: " +
          settings.account_type
        : "",
      settings.branch_code
        ? "Branch code: " +
          settings.branch_code
        : "",
      settings.swift_bic
        ? "SWIFT / BIC: " +
          settings.swift_bic
        : "",
      settings.payment_instructions ||
        "",
    ].filter(Boolean);

    for (const line of paymentLines) {
      for (const wrapped of wrapText(
        line,
        regular,
        8,
        480,
      )) {
        page.drawText(wrapped, {
          x: margin,
          y,
          size: 8,
          font: regular,
          color: MUTED,
        });

        y -= 11;
      }
    }

    if (settings.account_number) {
      y -= 6;

      page.drawText("ACCOUNT NUMBER", {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: BRAND,
        characterSpacing: 1,
      });

      y -= 16;

      page.drawRectangle({
        x: margin,
        y: y - 8,
        width: 220,
        height: 24,
        color: rgb(0.97, 0.98, 1),
        borderColor: BORDER,
        borderWidth: 0.7,
      });

      page.drawText(String(settings.account_number), {
        x: margin + 10,
        y: y - 1,
        size: 10,
        font: bold,
        color: DARK,
        characterSpacing: 0.8,
      });

      y -= 30;
    }
  }

  const footerY = 28;

  page.drawLine({
    start: {
      x: margin,
      y: footerY + 18,
    },
    end: {
      x: pageWidth - margin,
      y: footerY + 18,
    },
    thickness: 0.6,
    color: BORDER,
  });

  page.drawText(
    settings.business_name ||
      "Swayphics",
    {
      x: margin,
      y: footerY,
      size: 7,
      font: bold,
      color: BRAND,
    },
  );

  const footerRight =
    settings.email ||
    "info@swayphics.co.za";

  page.drawText(
    footerRight,
    {
      x:
        pageWidth -
        margin -
        regular.widthOfTextAtSize(
          footerRight,
          7,
        ),
      y: footerY,
      size: 7,
      font: regular,
      color: MUTED,
    },
  );

  return await pdfDoc.save();
}

function emailHtml(
  invoice: any,
  items: LineItem[],
  settings: any,
) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #E0E6F0;color:#081533;">
            ${escapeHtml(item.description)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #E0E6F0;text-align:center;color:#56627A;">
            ${escapeHtml(item.quantity)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #E0E6F0;text-align:right;color:#56627A;">
            ${escapeHtml(money(item.unit_price))}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #E0E6F0;text-align:right;color:#081533;font-weight:700;">
            ${escapeHtml(money(item.line_total))}
          </td>
        </tr>
      `,
    )
    .join("");

  return `
<!doctype html>
<html>
<body style="margin:0;background:#F7FAFF;font-family:Arial,Helvetica,sans-serif;color:#081533;">
  <div style="max-width:680px;margin:0 auto;padding:32px 18px;">
    <div style="background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E0E6F0;">
      <div style="padding:26px 28px;background:linear-gradient(135deg,#002096,#0152F4);color:#FFFFFF;">
        <div style="font-size:24px;font-weight:800;letter-spacing:-0.03em;">SWAYPHICS</div>
        <div style="margin-top:6px;font-size:11px;letter-spacing:0.16em;font-weight:700;">EMPOWERING THROUGH DESIGN</div>
      </div>
      <div style="padding:28px;">
        <div style="font-size:12px;color:#56627A;">Invoice ${escapeHtml(invoice.invoice_number)}</div>
        <h1 style="margin:6px 0 18px;font-size:24px;color:#081533;">Your Swayphics invoice</h1>
        <p style="font-size:14px;line-height:1.7;color:#56627A;">
          Please find your invoice attached. Thank you for choosing Swayphics.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-top:24px;">
          <thead>
            <tr style="background:#F7FAFF;">
              <th style="padding:10px 8px;text-align:left;font-size:11px;">Description</th>
              <th style="padding:10px 8px;text-align:center;font-size:11px;">Qty</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;">Price</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:22px;text-align:right;">
          <div style="font-size:12px;color:#56627A;">Subtotal: <strong style="color:#081533;">${escapeHtml(money(invoice.subtotal))}</strong></div>
          ${Number(invoice.discount || 0) > 0 ? `<div style="font-size:12px;color:#56627A;margin-top:5px;">Discount: <strong style="color:#081533;">-${escapeHtml(money(invoice.discount))}</strong></div>` : ""}
          ${Number(invoice.vat_amount || 0) > 0 ? `<div style="font-size:12px;color:#56627A;margin-top:5px;">VAT: <strong style="color:#081533;">${escapeHtml(money(invoice.vat_amount))}</strong></div>` : ""}
          <div style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#002096;color:#FFFFFF;font-size:17px;font-weight:800;">
            Total ${escapeHtml(money(invoice.total))}
          </div>
        </div>
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid #E0E6F0;font-size:12px;line-height:1.7;color:#56627A;">
          <strong style="color:#081533;">Due:</strong> ${escapeHtml(shortDate(invoice.due_date))}
          ${settings.payment_instructions ? `<br><strong style="color:#081533;">Payment:</strong> ${escapeHtml(settings.payment_instructions)}` : ""}
        </div>
        ${
          settings.bank_name ||
          settings.account_name ||
          settings.account_number ||
          settings.account_type ||
          settings.branch_code ||
          settings.swift_bic
            ? `
        <div style="margin-top:18px;padding:16px 18px;border-radius:12px;background:#F7FAFF;border:1px solid #E0E6F0;font-size:12px;line-height:1.75;color:#56627A;">
          <strong style="display:block;margin-bottom:8px;color:#081533;">Banking details</strong>
          ${settings.bank_name ? `Bank: ${escapeHtml(settings.bank_name)}<br>` : ""}
          ${settings.account_name ? `Account holder: ${escapeHtml(settings.account_name)}<br>` : ""}
          ${settings.account_type ? `Account type: ${escapeHtml(settings.account_type)}<br>` : ""}
          ${settings.branch_code ? `Branch code: ${escapeHtml(settings.branch_code)}<br>` : ""}
          ${settings.swift_bic ? `SWIFT / BIC: ${escapeHtml(settings.swift_bic)}<br>` : ""}
          ${settings.account_number ? `
          <div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:#FFFFFF;border:1px solid #D9E2F0;">
            <div style="font-size:10px;font-weight:800;letter-spacing:.12em;color:#0152F4;">ACCOUNT NUMBER</div>
            <div style="margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;font-weight:800;letter-spacing:.08em;color:#081533;user-select:text;-webkit-user-select:text;">${escapeHtml(String(settings.account_number))}</div>
          </div>` : ""}
        </div>`
            : ""
        }
      </div>
      <div style="padding:18px 28px;background:#F7FAFF;font-size:11px;color:#56627A;">
        ${escapeHtml(settings.email || "info@swayphics.co.za")} · ${escapeHtml(settings.website || "https://swayphics.co.za")}
      </div>
    </div>
  </div>
</body>
</html>
`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ||
      req.headers.get("authorization");

    const accessToken =
      authHeader?.replace(
        /^Bearer\s+/i,
        "",
      );

    if (!accessToken) {
      return Response.json(
        { error: "Authentication required." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const body: InvoiceRequest =
      await req.json();

    const invoiceId =
      body.invoice_id?.trim();

    const action =
      body.action === "send"
        ? "send"
        : "pdf";

    if (!invoiceId) {
      return Response.json(
        { error: "Invoice ID is required." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Supabase server configuration is missing.",
      );
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        },
      );

    const publicApiKey =
      req.headers.get("apikey") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!publicApiKey) {
      throw new Error(
        "Supabase public API key is missing.",
      );
    }

    const authSupabase =
      createClient(
        supabaseUrl,
        publicApiKey,
        {
          global: {
            headers: {
              Authorization:
                "Bearer " +
                accessToken,
            },
          },
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        },
      );

    const {
      data: userData,
      error: userError,
    } =
      await authSupabase.auth.getUser(
        accessToken,
      );

    if (
      userError ||
      !userData.user
    ) {
      return Response.json(
        { error: "Your session is no longer valid." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: isAdmin,
      error: adminError,
    } =
      await authSupabase.rpc(
        "is_swayphics_admin",
      );

    if (
      adminError ||
      isAdmin !== true
    ) {
      return Response.json(
        {
          error:
            "You are not an active Swayphics admin.",
        },
        {
          status: 403,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: invoice,
      error: invoiceError,
    } =
      await supabase
        .from("invoices")
        .select("*")
        .eq(
          "id",
          invoiceId,
        )
        .maybeSingle();

    if (invoiceError) {
      throw new Error(
        "Invoice lookup failed: " +
        invoiceError.message,
      );
    }

    if (!invoice) {
      throw new Error(
        "Invoice could not be found for ID " +
        invoiceId +
        ".",
      );
    }

    const {
      data: client,
      error: clientError,
    } =
      await supabase
        .from("clients")
        .select(
          "id,business_name,contact_name,email,phone",
        )
        .eq(
          "id",
          invoice.client_id,
        )
        .maybeSingle();

    if (clientError) {
      throw new Error(
        "Client lookup failed: " +
        clientError.message,
      );
    }

    if (!client) {
      throw new Error(
        "Client could not be found for this invoice.",
      );
    }

    invoice.client = client;

    if (
      action === "send" &&
      !String(client.email || "").trim()
    ) {
      throw new Error(
        "Client does not have an email address. Add a client email before sending the invoice.",
      );
    }

    const {
      data: items,
      error: itemsError,
    } =
      await supabase
        .from("invoice_items")
        .select(
          "description,quantity,unit_price,line_total",
        )
        .eq(
          "invoice_id",
          invoiceId,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        );

    if (
      itemsError
    ) {
      throw new Error(
        "Invoice items could not be loaded.",
      );
    }

    const {
      data: settings,
      error: settingsError,
    } =
      await supabase
        .from("invoice_settings")
        .select("*")
        .eq("id", 1)
        .single();

    if (
      settingsError ||
      !settings
    ) {
      throw new Error(
        "Invoice settings could not be loaded.",
      );
    }

    const lineItems =
      (items || []).map(
        (item: any) => ({
          description:
            item.description,
          quantity:
            Number(item.quantity || 0),
          unit_price:
            Number(item.unit_price || 0),
          line_total:
            Number(item.line_total || 0),
        }),
      );

    if (!lineItems.length) {
      throw new Error(
        "Invoice has no line items.",
      );
    }

    if (
      action === "send" &&
      !resendApiKey
    ) {
      return Response.json(
        {
          error:
            "Email sending is not configured yet. Add RESEND_API_KEY to your Supabase Edge Function secrets.",
        },
        {
          status: 503,
          headers: corsHeaders,
        },
      );
    }

    const pdfBytes =
      await buildPdf(
        invoice,
        lineItems,
        settings,
      );

    const pdfBase64 =
      bytesToBase64(
        pdfBytes,
      );

    if (action === "pdf") {
      return Response.json(
        {
          success: true,
          invoice_number:
            invoice.invoice_number,
          filename:
            invoice.invoice_number +
            ".pdf",
          pdf_base64:
            pdfBase64,
        },
        {
          status: 200,
          headers: corsHeaders,
        },
      );
    }

    await supabase
      .from("invoices")
      .update({
        email_status: "sending",
        email_error: null,
      })
      .eq("id", invoiceId);

    const fromEmail =
      Deno.env.get(
        "RESEND_FROM_EMAIL",
      ) ||
      "Swayphics <info@swayphics.co.za>";

    const emailResponse =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization:
              "Bearer " +
              resendApiKey,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [
              invoice.client?.email,
            ],
            subject:
              "Invoice " +
              invoice.invoice_number +
              " from Swayphics",
            html:
              emailHtml(
                invoice,
                lineItems,
                settings,
              ),
            attachments: [
              {
                filename:
                  invoice.invoice_number +
                  ".pdf",
                content:
                  pdfBase64,
              },
            ],
          }),
        },
      );

    const emailResponseText =
      await emailResponse.text();

    let emailResult: any = {};

    try {
      emailResult =
        emailResponseText
          ? JSON.parse(
              emailResponseText,
            )
          : {};
    } catch {
      emailResult = {
        raw: emailResponseText,
      };
    }

    if (!emailResponse.ok) {
      const errorMessage =
        emailResult?.message ||
        emailResult?.error?.message ||
        emailResponseText ||
        "Email provider rejected the request.";

      await supabase
        .from("invoices")
        .update({
          email_status: "failed",
          email_error:
            String(
              errorMessage,
            ).slice(0, 1000),
        })
        .eq("id", invoiceId);

      throw new Error(
        String(
          errorMessage,
        ),
      );
    }

    const emailId =
      emailResult?.id ||
      null;

    await supabase
      .from("invoices")
      .update({
        status:
          invoice.status === "draft"
            ? "sent"
            : invoice.status,
        email_status: "sent",
        sent_at:
          new Date().toISOString(),
        email_id:
          emailId,
        email_error: null,
      })
      .eq("id", invoiceId);

    return Response.json(
      {
        success: true,
        invoice_number:
          invoice.invoice_number,
        email_id:
          emailId,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error(
      "Invoice function error:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process invoice.",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
