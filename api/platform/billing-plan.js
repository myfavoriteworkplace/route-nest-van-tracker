const { withTransaction } = require("../../server/database");
const { context, HttpError } = require("../../server/api-utils");
const {
  RazorpayError,
  verifyRecurringPlan,
} = require("../../server/razorpay");

async function handler(req, res) {
  const { auth, config, pool, tenant } = context(req);
  if (!(await tenant.isPlatformAdmin(auth.userId))) {
    throw new HttpError(403, "Platform Super Admin access required.", "platform_admin_required");
  }

  const monthlyPlanId = String(req.body?.provider_plan_id || "").trim();
  const annualPlanId = String(req.body?.provider_annual_plan_id || "").trim();
  const monthlyPrice = Number(req.body?.monthly_price_paise);
  const annualPrice = Number(req.body?.annual_price_paise);
  if (
    monthlyPlanId.length > 100 ||
    annualPlanId.length > 100 ||
    !monthlyPlanId ||
    !annualPlanId
  ) {
    throw new HttpError(400, "Monthly and annual Razorpay Plan IDs are required.", "invalid_plan_id");
  }
  if (
    !Number.isSafeInteger(monthlyPrice) ||
    monthlyPrice < 0 ||
    monthlyPrice > 2_147_483_647 ||
    !Number.isSafeInteger(annualPrice) ||
    annualPrice < 0 ||
    annualPrice > 2_147_483_647
  ) {
    throw new HttpError(400, "Prices must be non-negative integer paise values.", "invalid_price");
  }

  let monthlyPlan;
  let annualPlan;
  try {
    [monthlyPlan, annualPlan] = await Promise.all([
      verifyRecurringPlan({
        config,
        planId: monthlyPlanId,
        interval: "monthly",
        amountPaise: monthlyPrice,
      }),
      verifyRecurringPlan({
        config,
        planId: annualPlanId,
        interval: "annual",
        amountPaise: annualPrice,
      }),
    ]);
  } catch (error) {
    if (error instanceof RazorpayError && error.code === "razorpay_not_configured") {
      throw new HttpError(503, "Razorpay API credentials are not configured.", "razorpay_not_configured");
    }
    throw new HttpError(502, "Razorpay could not verify the recurring plans.", "razorpay_unavailable");
  }
  if (!monthlyPlan.valid || !annualPlan.valid) {
    throw new HttpError(
      422,
      "The plan IDs, billing periods, currencies and amounts must match the saved prices.",
      "razorpay_plan_mismatch",
    );
  }

  const plan = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE plans
          SET provider_plan_id=$1,provider_annual_plan_id=$2,
              monthly_price_paise=$3,annual_price_paise=$4
        WHERE code='school-standard'
        RETURNING id,code,name,provider_plan_id,provider_annual_plan_id,
                  monthly_price_paise,annual_price_paise`,
      [monthlyPlanId, annualPlanId, monthlyPrice, annualPrice],
    );
    if (!result.rows.length) {
      throw new HttpError(404, "School Standard plan not found.", "plan_not_found");
    }
    await tenant.writeAudit({
      client,
      actorUserId: auth.userId,
      action: "billing.plan_configured",
      targetType: "plan",
      targetId: result.rows[0].id,
      details: {
        provider_plan_id: monthlyPlanId,
        provider_annual_plan_id: annualPlanId,
        monthly_price_paise: monthlyPrice,
        annual_price_paise: annualPrice,
      },
    });
    return result.rows[0];
  });
  return res.json({ plan });
}

module.exports = { methods: ["POST"], handler };
