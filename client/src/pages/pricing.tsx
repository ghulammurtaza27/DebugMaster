import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

const tiers = [
  {
    name: "Basic",
    price: "$9",
    description: "Perfect for individual developers",
    features: [
      "Up to 100 issues/month",
      "Basic error analysis",
      "GitHub integration",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$29",
    description: "For growing development teams",
    features: [
      "Up to 1000 issues/month",
      "Advanced error analysis",
      "Priority issue fixing",
      "Knowledge graph analysis",
      "Premium support",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "$99",
    description: "For large organizations",
    features: [
      "Unlimited issues",
      "Custom integrations",
      "Advanced analytics",
      "Dedicated support",
      "Custom deployment",
      "SLA guarantees",
    ],
  },
];

export default function Pricing() {
  const { user } = useAuth();

  return (
    <div className="py-24 px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
        <p className="text-xl text-muted-foreground">
          Choose the plan that best fits your needs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
        {tiers.map((tier) => (
          <Card
            key={tier.name}
            className={`relative ${
              tier.popular
                ? "border-primary shadow-lg scale-105"
                : "border-border"
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <span className="bg-primary text-primary-foreground text-sm font-medium px-3 py-1 rounded-full">
                  Most Popular
                </span>
              </div>
            )}

            <CardHeader>
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>{tier.description}</CardDescription>
            </CardHeader>

            <CardContent>
              <div className="mb-8">
                <span className="text-4xl font-bold">{tier.price}</span>
                <span className="text-muted-foreground">/month</span>
              </div>

              <ul className="space-y-4">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center">
                    <Check className="h-5 w-5 text-green-500 mr-2" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter>
              <Button
                className="w-full"
                variant={tier.popular ? "default" : "outline"}
                size="lg"
              >
                {user ? "Upgrade to " + tier.name : "Get Started"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
