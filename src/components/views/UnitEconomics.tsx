import { Check, Building2, Zap, ShieldCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

export const UnitEconomics = () => {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      {/* Header */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
          SaaS Unit Economics & Product Tiering
        </h1>
        <p className="text-[var(--color-muted)] max-w-2xl mx-auto">
          High-margin recurring revenue with strict usage boundaries. Structured for profitability and cash-flow protection.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Growth Tier — Sweet Spot */}
        <Card
          className="relative border-2 border-[var(--color-foreground)] shadow-[var(--shadow-card)]"
          padding="lg"
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge tone="amber" size="sm">Your Sweet Spot</Badge>
          </div>
          <div className="mb-6">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <Zap size={18} className="text-[var(--color-accent-amber)]" />
              Growth Tier
            </h3>
            <p className="text-sm text-[var(--color-muted)] mt-1">Standard operational license</p>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold">₦180,000</span>
              <span className="text-sm text-[var(--color-muted)]">/month</span>
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">
              Covers infrastructure (~₦63,000) · nets ~₦117,000 pure margin
            </p>
          </div>
          <ul className="space-y-3 text-sm mb-8">
            {[
              'Full operational platform access',
              'Cloud infrastructure included',
              'Standard support & updates',
              'Quarterly or annual billing',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 text-[var(--color-success)] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Button variant="primary" fullWidth>
            Choose Growth
          </Button>
        </Card>

        {/* Enterprise Tier */}
        <Card padding="lg">
          <div className="mb-6">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <Building2 size={18} className="text-[var(--color-accent-cobalt)]" />
              Enterprise Tier
            </h3>
            <p className="text-sm text-[var(--color-muted)] mt-1">Multi-Hub Control</p>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold">₦250,000+</span>
              <span className="text-sm text-[var(--color-muted)]">/month</span>
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">Designed for larger operations</p>
          </div>
          <ul className="space-y-3 text-sm mb-8">
            {[
              'Everything in Growth',
              'Full multi-hub reporting',
              'Advanced audit logging',
              'Priority remote maintenance',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 text-[var(--color-success)] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" fullWidth>
            Contact Sales
          </Button>
        </Card>

        {/* Onboarding Fee */}
        <Card padding="lg" className="md:col-span-2 lg:col-span-1">
          <div className="mb-6">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck size={18} className="text-[var(--color-purple)]" />
              Mandatory Onboarding
            </h3>
            <p className="text-sm text-[var(--color-muted)] mt-1">One-time setup fee</p>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline">
              <span className="text-4xl font-bold">₦250k–350k</span>
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">Never deploy a tenant for free</p>
          </div>
          <ul className="space-y-3 text-sm mb-8">
            {[
              'Immediate cash flow',
              'Covers initial setup time',
              'Ensures client commitment',
              'Required before any deployment',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 text-[var(--color-success)] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" fullWidth>
            Start Onboarding
          </Button>
        </Card>
      </div>

      {/* Cash Flow Protection */}
      <Card padding="lg">
        <h2 className="text-2xl font-semibold mb-6">Cash Flow Protection</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-success-bg)] text-[var(--color-success)]">
              <Check size={18} />
            </div>
            <div>
              <h3 className="font-medium">Upfront Billing Only</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                All tiers billed quarterly or annually upfront. Monthly billing in arrears is strictly forbidden.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-error-bg)] text-[var(--color-error)]">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h3 className="font-medium">Automatic Access Termination</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                If a tenant fails to renew, access terminates automatically. No grace periods. No revenue leakage.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <p className="text-center text-sm text-[var(--color-muted)]">
        Structured for profitability · Built with shadcn-inspired components
      </p>
    </div>
  );
};
