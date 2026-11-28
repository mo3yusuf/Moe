import { createSampleRestaurant } from './actions';

export default function SampleRestaurant() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1 style={{ margin: 0 }}>Sample restaurant</h1>
      <div className="card stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>Creates <strong>CRAVE Demo Kitchen</strong> in Fortitude Valley, owned by you and already approved, so you can test and demo the whole flow:</p>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>A full menu: burgers, sides, drinks, a dessert and a meal deal</li>
          <li>Uber Eats-style options: choose a side, a sauce for fries, extras with quantities, remove ingredients</li>
          <li>Open every day, all day (change it in Hours)</li>
        </ul>
        <p className="muted" style={{ margin: 0 }}>Then: add dish photos in Menu, connect test payouts in Payouts, and post a video in Videos with a featured dish. Swipe right on it in the app to order. Pressing the button again just opens the same restaurant.</p>
        <form action={createSampleRestaurant}><button className="btn big">Create sample restaurant</button></form>
      </div>
    </div>
  );
}
