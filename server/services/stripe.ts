import Stripe from "stripe";
import { storage } from "../storage";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export class StripeService {
  private readonly PRICE_IDS = {
    basic: process.env.STRIPE_BASIC_PRICE_ID,
    pro: process.env.STRIPE_PRO_PRICE_ID,
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
  };

  async createCustomer(email: string, name: string) {
    return await stripe.customers.create({
      email,
      name,
      metadata: {
        source: "debug_service",
      },
    });
  }

  async createSubscription(
    customerId: string,
    priceId: string,
    trialDays: number = 14
  ) {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
    });

    return subscription;
  }

  async updateSubscription(subscriptionId: string, priceId: string) {
    return await stripe.subscriptions.retrieve(subscriptionId);
  }

  async cancelSubscription(subscriptionId: string) {
    return await stripe.subscriptions.cancel(subscriptionId);
  }

  async handleWebhook(
    signature: string,
    payload: Buffer,
    webhookSecret: string
  ) {
    try {
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );

      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          await this.updateUserSubscription(subscription);
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await this.handleSubscriptionCanceled(subscription);
          break;
        }
      }

      return { received: true };
    } catch (err) {
      console.error("Error processing webhook:", err);
      throw err;
    }
  }

  private async updateUserSubscription(stripeSubscription: Stripe.Subscription) {
    const user = await storage.getUserByStripeCustomerId(
      stripeSubscription.customer as string
    );
    if (!user) return;

    await storage.updateUserSubscription(user.id, {
      stripeSubscriptionId: stripeSubscription.id,
      subscriptionStatus: stripeSubscription.status,
      subscriptionTier: this.getTierFromPriceId(
        stripeSubscription.items.data[0].price.id
      ),
      trialEndsAt: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
    });
  }

  private async handleSubscriptionCanceled(
    stripeSubscription: Stripe.Subscription
  ) {
    const user = await storage.getUserByStripeCustomerId(
      stripeSubscription.customer as string
    );
    if (!user) return;

    await storage.updateUserSubscription(user.id, {
      subscriptionStatus: "canceled",
      subscriptionTier: "free",
      trialEndsAt: null,
    });
  }

  private getTierFromPriceId(priceId: string): string {
    if (priceId === this.PRICE_IDS.basic) return "basic";
    if (priceId === this.PRICE_IDS.pro) return "pro";
    if (priceId === this.PRICE_IDS.enterprise) return "enterprise";
    return "free";
  }
}

export const stripeService = new StripeService();
