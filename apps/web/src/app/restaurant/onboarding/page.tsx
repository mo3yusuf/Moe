import { BRISBANE_SUBURBS, CUISINES, titleCase } from '@crave/core';
import { OnboardForm } from './onboard-form';

export default function Onboarding() {
  return (
    <div className="card stack">
      <h1 style={{ margin: 0 }}>Register your restaurant</h1>
      <p className="muted" style={{ margin: 0 }}>
        No filming required — list your menu with photos and CRAVE creators can feature your dishes. You can add videos any time.
        Your restaurant stays hidden from customers until CRAVE verifies it.
      </p>
      <OnboardForm suburbs={Object.keys(BRISBANE_SUBURBS).sort()} cuisines={CUISINES.map((c) => [c, titleCase(c)])} />
    </div>
  );
}
