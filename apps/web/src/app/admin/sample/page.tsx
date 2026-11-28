import { createSampleRestaurants } from './actions';

const SAMPLES = [
  ['CRAVE Demo Kitchen', 'Burgers · Fortitude Valley', 'Double Smash Burger'],
  ['Kōen Sushi Bar', 'Japanese · Brisbane City', 'Salmon Aburi Nigiri'],
  ['Cedar & Ember Grill', 'Lebanese · West End', 'Mixed Grill Plate'],
  ['Little Lantern Thai', 'Thai · South Brisbane', 'Green Curry'],
  ['Forno Rosso Pizzeria', 'Pizza · New Farm', 'Margherita'],
];

export default function SampleRestaurants() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1 style={{ margin: 0 }}>Sample restaurants</h1>
      <div className="card stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>Creates five sample restaurants, owned by you and already approved, so you can test and demo the whole flow. Each has a location, all-day opening hours, a full menu with Uber Eats-style options, and a sample video of its signature dish in the feed:</p>
        <table><thead><tr><th>Restaurant</th><th>Cuisine · area</th><th>Video dish</th></tr></thead>
          <tbody>{SAMPLES.map(([n, c, d]) => <tr key={n}><td>{n}</td><td className="muted">{c}</td><td>{d}</td></tr>)}</tbody></table>
        <p className="muted" style={{ margin: 0 }}>Sample videos are branded motion videos marked “Sample video”. Swipe right on one in the app to open its dish and order. To take card orders, connect test payouts in each restaurant’s Payouts. Replace sample videos with real footage in each restaurant’s Videos page. Pressing the button again changes nothing.</p>
        <form action={createSampleRestaurants}><button className="btn big">Create sample restaurants</button></form>
      </div>
    </div>
  );
}
