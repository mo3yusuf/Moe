// =============================================================================
// CRAVE DEMO DATA — fictional restaurants, people and dishes for development.
// Every restaurant and video is flagged is_demo = true and labelled "DEMO" in
// the app. Addresses use real Brisbane suburbs with illustrative street numbers;
// none of these businesses exist. Videos are public sample clips (NOT food
// footage) used only as playback placeholders — replace them with licensed food
// videos uploaded through the Create tab or the merchant dashboard.
// =============================================================================

export const DEMO_PASSWORD = 'CraveDemo!2026'; // local development only

export const users = [
  { key: 'admin', email: 'admin@demo.crave.local', name: 'CRAVE Admin', username: 'crave_admin', roles: ['admin'] },
  { key: 'customer', email: 'sam@demo.crave.local', name: 'Sam Customer', username: 'sam_eats', roles: [] },
  { key: 'customer2', email: 'alex@demo.crave.local', name: 'Alex Customer', username: 'alex_bne', roles: [] },
  { key: 'creator1', email: 'mia@demo.crave.local', name: 'Mia Eats Brisbane', username: 'mia_eats_bne', roles: ['creator'], creator: true },
  { key: 'creator2', email: 'jordan@demo.crave.local', name: 'Jordan Food Diaries', username: 'jordan_food', roles: ['creator'], creator: true },
  { key: 'owner_ember', email: 'owner.ember@demo.crave.local', name: 'Priya (Ember & Bun)', username: 'ember_owner', roles: [] },
  { key: 'owner_kaizen', email: 'owner.kaizen@demo.crave.local', name: 'Kenji (Kaizen)', username: 'kaizen_owner', roles: [] },
  { key: 'owner_nonna', email: 'owner.nonna@demo.crave.local', name: 'Lucia (Nonna Rosa)', username: 'nonna_owner', roles: [] },
  { key: 'owner_saffron', email: 'owner.saffron@demo.crave.local', name: 'Omar (Saffron Lane)', username: 'saffron_owner', roles: [] },
  { key: 'owner_lagoon', email: 'owner.lagoon@demo.crave.local', name: 'Tess (Lagoon Shack)', username: 'lagoon_owner', roles: [] },
  { key: 'owner_bao', email: 'owner.bao@demo.crave.local', name: 'Wei (Bao Down)', username: 'bao_owner', roles: [] },
  { key: 'owner_sweet', email: 'owner.sweet@demo.crave.local', name: 'Grace (Sweet Lab)', username: 'sweet_owner', roles: [] },
];

const SAMPLE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
export const sampleClips = [
  `${SAMPLE}/ForBiggerBlazes.mp4`,
  `${SAMPLE}/ForBiggerEscapes.mp4`,
  `${SAMPLE}/ForBiggerFun.mp4`,
  `${SAMPLE}/ForBiggerJoyrides.mp4`,
  `${SAMPLE}/ForBiggerMeltdowns.mp4`,
];

const weekly = (opens, closes, days = [0, 1, 2, 3, 4, 5, 6]) => days.map((d) => ({ day: d, opens, closes }));

const sizeGroup = (small = 0, large = 350) => ({
  name: 'Size', min: 1, max: 1,
  options: [{ name: 'Regular', delta: small, isDefault: true }, { name: 'Large', delta: large }],
});

export const restaurants = [
  {
    key: 'ember', owner: 'owner_ember', slug: 'demo-ember-and-bun', name: 'Ember & Bun (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Smash burgers on brioche, halal-certified beef, crinkle fries.',
    cuisines: ['American', 'Burgers'], priceLevel: 2, verifiedDietary: ['halal_certified'], status: 'active',
    location: { street: '120 Brunswick St', suburb: 'Fortitude Valley', postcode: '4006', lat: -27.4573, lng: 153.0352 },
    hours: weekly('11:00', '22:00'), prep: 12,
    items: [
      { key: 'smash', name: 'Double Smash Burger', price: 1890, cuisine: 'American', category: 'burgers', tags: ['burger', 'beef', 'cheese', 'halal'], dietary: ['halal_certified'], allergens: ['gluten', 'dairy', 'sesame'], spice: 0,
        description: 'Two halal beef patties, American cheese, pickles, house sauce, toasted brioche.',
        groups: [
          { name: 'Make it a meal', min: 0, max: 1, options: [{ name: 'Fries + drink', delta: 650 }] },
          { name: 'Extras', min: 0, max: 3, options: [{ name: 'Extra patty', delta: 450 }, { name: 'Bacon (beef)', delta: 300 }, { name: 'Jalapeños', delta: 100 }] },
        ] },
      { key: 'chicken', name: 'Nashville Hot Chicken Burger', price: 1790, cuisine: 'American', category: 'burgers', tags: ['burger', 'chicken', 'spicy', 'halal'], dietary: ['halal_certified'], allergens: ['gluten', 'egg'], spice: 3,
        description: 'Crispy halal chicken thigh, Nashville hot oil, slaw, pickles.', groups: [sizeGroup(0, 400)] },
      { key: 'fries', name: 'Loaded Crinkle Fries', price: 990, cuisine: 'American', category: 'sides', tags: ['fries', 'cheese'], dietary: ['halal_certified', 'vegetarian'], allergens: ['dairy'], spice: 1,
        description: 'Crinkle fries, cheese sauce, crispy shallots.', groups: [] },
    ],
  },
  {
    key: 'kaizen', owner: 'owner_kaizen', slug: 'demo-kaizen-sushi', name: 'Kaizen Sushi Bar (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Aburi nigiri, hand rolls and donburi.',
    cuisines: ['Japanese', 'Sushi'], priceLevel: 3, verifiedDietary: [], status: 'active',
    location: { street: '45 Grey St', suburb: 'South Brisbane', postcode: '4101', lat: -27.4784, lng: 153.0198 },
    hours: [...weekly('11:30', '14:30', [2, 3, 4, 5, 6]), ...weekly('17:00', '21:30', [2, 3, 4, 5, 6])], prep: 18,
    items: [
      { key: 'aburi', name: 'Aburi Salmon Nigiri (8 pc)', price: 2600, cuisine: 'Japanese', category: 'sushi', tags: ['sushi', 'salmon', 'seafood'], dietary: [], allergens: ['fish', 'soy', 'sesame'], spice: 0,
        description: 'Flame-seared salmon nigiri with miso mayo and shallot.', groups: [] },
      { key: 'chirashi', name: 'Chirashi Don', price: 3200, cuisine: 'Japanese', category: 'sushi', tags: ['sashimi', 'rice bowl', 'seafood', 'tuna'], dietary: [], allergens: ['fish', 'soy', 'crustacean'], spice: 0,
        description: 'Chef’s selection of sashimi over seasoned rice.', groups: [] },
      { key: 'karaage', name: 'Chicken Karaage', price: 1500, cuisine: 'Japanese', category: 'small plates', tags: ['chicken', 'fried'], dietary: [], allergens: ['gluten', 'soy'], spice: 1,
        description: 'Soy-ginger marinated fried chicken, kewpie, lemon.', groups: [sizeGroup(0, 600)] },
    ],
  },
  {
    key: 'nonna', owner: 'owner_nonna', slug: 'demo-nonna-rosa', name: 'Nonna Rosa Wood-Fired (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Neapolitan-style pizza and fresh pasta.',
    cuisines: ['Italian', 'Pizza'], priceLevel: 2, verifiedDietary: [], status: 'active', advanceOrders: true,
    location: { street: '900 Brunswick St', suburb: 'New Farm', postcode: '4005', lat: -27.4676, lng: 153.0466 },
    hours: weekly('12:00', '21:30'), prep: 15,
    items: [
      { key: 'margherita', name: 'Margherita DOP', price: 2200, cuisine: 'Italian', category: 'pizza', tags: ['pizza', 'cheese', 'tomato'], dietary: ['vegetarian'], allergens: ['gluten', 'dairy'], spice: 0,
        description: 'San Marzano tomato, fior di latte, basil, olive oil.',
        groups: [{ name: 'Base', min: 1, max: 1, options: [{ name: 'Classic', delta: 0, isDefault: true }, { name: 'Gluten-free base', delta: 400 }] },
                 { name: 'Extras', min: 0, max: 4, options: [{ name: 'Buffalo mozzarella', delta: 500 }, { name: 'Nduja', delta: 400 }, { name: 'Chilli oil', delta: 150 }] }] },
      { key: 'diavola', name: 'Diavola', price: 2500, cuisine: 'Italian', category: 'pizza', tags: ['pizza', 'salami', 'spicy', 'pork'], dietary: [], allergens: ['gluten', 'dairy'], spice: 2,
        description: 'Hot salami, fior di latte, chilli honey.', groups: [] },
      { key: 'vodka', name: 'Rigatoni alla Vodka', price: 2600, cuisine: 'Italian', category: 'pasta', tags: ['pasta', 'creamy', 'tomato'], dietary: ['vegetarian'], allergens: ['gluten', 'dairy'], spice: 1,
        description: 'Fresh rigatoni, creamy tomato vodka sauce, parmigiano.', groups: [] },
    ],
  },
  {
    key: 'saffron', owner: 'owner_saffron', slug: 'demo-saffron-lane', name: 'Saffron Lane Kitchen (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Charcoal-grilled Lebanese and Levantine plates.',
    cuisines: ['Lebanese', 'Middle Eastern'], priceLevel: 2, verifiedDietary: ['halal_certified'], status: 'active',
    location: { street: '60 Boundary St', suburb: 'West End', postcode: '4101', lat: -27.4817, lng: 153.0102 },
    hours: weekly('11:00', '23:00'), prep: 14,
    items: [
      { key: 'shawarma', name: 'Chicken Shawarma Plate', price: 2300, cuisine: 'Lebanese', category: 'plates', tags: ['chicken', 'shawarma', 'garlic', 'halal'], dietary: ['halal_certified'], allergens: ['sesame', 'gluten'], spice: 1,
        description: 'Charcoal chicken, toum, pickles, tabouli, hummus, flatbread.', groups: [sizeGroup(0, 500)] },
      { key: 'falafel', name: 'Falafel Wrap', price: 1550, cuisine: 'Lebanese', category: 'wraps', tags: ['falafel', 'wrap', 'chickpea'], dietary: ['halal_certified', 'vegan'], allergens: ['sesame', 'gluten'], spice: 0,
        description: 'Crispy falafel, tahini, pickled turnip, salad.', groups: [] },
      { key: 'mixed', name: 'Mixed Grill for Two', price: 5400, cuisine: 'Lebanese', category: 'plates', tags: ['lamb', 'chicken', 'kofta', 'halal', 'sharing'], dietary: ['halal_certified'], allergens: ['sesame', 'gluten'], spice: 1,
        description: 'Lamb kofta, shish tawook, lamb cutlets, rice, salads.', groups: [] },
    ],
  },
  {
    key: 'lagoon', owner: 'owner_lagoon', slug: 'demo-lagoon-seafood', name: 'Lagoon Seafood Shack (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Moreton Bay bug rolls, fish and chips, prawns.',
    cuisines: ['Seafood', 'Australian'], priceLevel: 3, verifiedDietary: [], status: 'active',
    location: { street: '1 Eagle St', suburb: 'Brisbane City', postcode: '4000', lat: -27.4688, lng: 153.0310 },
    hours: weekly('11:00', '20:30'), prep: 16,
    items: [
      { key: 'bugroll', name: 'Moreton Bay Bug Roll', price: 3400, cuisine: 'Seafood', category: 'rolls', tags: ['seafood', 'bug', 'crustacean', 'roll'], dietary: [], allergens: ['crustacean', 'gluten', 'egg'], spice: 0,
        description: 'Butter-poached bug tail, lemon mayo, chives, brioche roll.', groups: [] },
      { key: 'fishchips', name: 'Beer-Battered Fish & Chips', price: 2400, cuisine: 'Seafood', category: 'fish and chips', tags: ['fish', 'seafood', 'fried', 'chips'], dietary: [], allergens: ['fish', 'gluten'], spice: 0,
        description: 'Local barramundi, chips, tartare, lemon.', groups: [sizeGroup(0, 700)] },
      { key: 'prawns', name: 'Garlic Chilli Prawns', price: 2900, cuisine: 'Seafood', category: 'plates', tags: ['prawns', 'seafood', 'garlic', 'spicy'], dietary: ['gluten_free'], allergens: ['crustacean'], spice: 2,
        description: 'Wild prawns, garlic, chilli, parsley, sourdough.', groups: [] },
    ],
  },
  {
    key: 'bao', owner: 'owner_bao', slug: 'demo-bao-down', name: 'Bao Down (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Taiwanese bao, dumplings and late-night noodles.',
    cuisines: ['Taiwanese', 'Asian'], priceLevel: 1, verifiedDietary: [], status: 'active',
    location: { street: '700 Stanley St', suburb: 'Woolloongabba', postcode: '4102', lat: -27.4893, lng: 153.0353 },
    hours: [...weekly('11:30', '15:00', [1, 2, 3, 4, 5, 6, 0]), ...weekly('17:00', '02:00', [4, 5, 6])], prep: 10,
    items: [
      { key: 'porkbao', name: 'Pork Belly Bao (2)', price: 1400, cuisine: 'Taiwanese', category: 'bao', tags: ['bao', 'pork', 'peanut'], dietary: [], allergens: ['gluten', 'peanut', 'soy'], spice: 1,
        description: 'Braised pork belly, peanut crumb, coriander, pickled mustard greens.', groups: [] },
      { key: 'dumplings', name: 'Chilli Oil Wontons', price: 1300, cuisine: 'Taiwanese', category: 'dumplings', tags: ['dumplings', 'pork', 'spicy'], dietary: [], allergens: ['gluten', 'soy', 'sesame'], spice: 3,
        description: 'Pork and prawn wontons in house chilli oil, black vinegar.', groups: [sizeGroup(0, 500)] },
      { key: 'beefnoodle', name: 'Braised Beef Noodle Soup', price: 1900, cuisine: 'Taiwanese', category: 'noodles', tags: ['noodles', 'beef', 'soup'], dietary: [], allergens: ['gluten', 'soy'], spice: 2,
        description: 'Slow-braised beef shin, hand-pulled noodles, bok choy.', groups: [] },
    ],
  },
  {
    key: 'sweet', owner: 'owner_sweet', slug: 'demo-sweet-lab', name: 'Sweet Lab Desserts (DEMO)',
    description: 'DEMO RESTAURANT — fictional. Pending verification, so NOT orderable (tests the verification gate).',
    cuisines: ['Desserts'], priceLevel: 2, verifiedDietary: [], status: 'pending_verification',
    location: { street: '200 Given Tce', suburb: 'Paddington', postcode: '4064', lat: -27.4601, lng: 152.9994 },
    hours: weekly('12:00', '22:00'), prep: 8,
    items: [
      { key: 'cookie', name: 'Molten Cookie Skillet', price: 1600, cuisine: 'Desserts', category: 'desserts', tags: ['dessert', 'chocolate', 'cookie'], dietary: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], spice: 0,
        description: 'Warm cookie skillet, vanilla gelato, salted caramel.', groups: [] },
    ],
  },
];

// Videos: who uploaded, which dish they feature, and whether the tag is approved.
export const videos = [
  { key: 'v_smash_mia', uploader: 'creator1', restaurant: 'ember', item: 'smash', link: 'approved', caption: 'The cheesiest smash burger in the Valley 🔥 #burger #brisbane #halal', sponsored: false },
  { key: 'v_smash_house', uploader: 'owner_ember', restaurant: 'ember', item: 'smash', link: 'approved', kind: 'restaurant', caption: 'Watch us smash it. Double patty, double cheese. #burger', sponsored: false },
  { key: 'v_hotchicken', uploader: 'creator2', restaurant: 'ember', item: 'chicken', link: 'approved', caption: 'Nashville hot at level 3 — would you try it? #spicy #chicken', sponsored: true, disclosure: 'Gifted meal from Ember & Bun (DEMO)' },
  { key: 'v_aburi', uploader: 'creator1', restaurant: 'kaizen', item: 'aburi', link: 'approved', caption: 'Flame-seared salmon nigiri 🍣 #sushi #southbank', sponsored: false },
  { key: 'v_chirashi', uploader: 'owner_kaizen', restaurant: 'kaizen', item: 'chirashi', link: 'approved', kind: 'restaurant', caption: 'Today’s chirashi don. #sashimi', sponsored: false },
  { key: 'v_marg', uploader: 'creator2', restaurant: 'nonna', item: 'margherita', link: 'approved', caption: '90 seconds in a 450°C oven 🍕 #pizza #newfarm', sponsored: false },
  { key: 'v_vodka', uploader: 'owner_nonna', restaurant: 'nonna', item: 'vodka', link: 'approved', kind: 'restaurant', caption: 'Rigatoni alla vodka, tossed to order. #pasta', sponsored: false },
  { key: 'v_shawarma', uploader: 'creator1', restaurant: 'saffron', item: 'shawarma', link: 'approved', caption: 'That toum though 🧄 #shawarma #westend #halal', sponsored: false },
  { key: 'v_mixedgrill', uploader: 'owner_saffron', restaurant: 'saffron', item: 'mixed', link: 'approved', kind: 'restaurant', caption: 'Mixed grill for two, straight off the charcoal. #lebanese', sponsored: false },
  { key: 'v_bugroll', uploader: 'creator2', restaurant: 'lagoon', item: 'bugroll', link: 'approved', caption: 'Moreton Bay bug roll by the river 🦞 #seafood', sponsored: false },
  { key: 'v_prawns', uploader: 'owner_lagoon', restaurant: 'lagoon', item: 'prawns', link: 'approved', kind: 'restaurant', caption: 'Garlic chilli prawns, sizzling. #prawns', sponsored: false },
  { key: 'v_bao', uploader: 'creator1', restaurant: 'bao', item: 'porkbao', link: 'approved', caption: 'Pork belly bao at 1am hits different #bao #latenight', sponsored: false },
  { key: 'v_wontons', uploader: 'creator2', restaurant: 'bao', item: 'dumplings', link: 'pending', caption: 'Chilli oil wontons (tag awaiting restaurant approval) #dumplings', sponsored: false },
  { key: 'v_cookie', uploader: 'creator1', restaurant: 'sweet', item: 'cookie', link: 'approved', caption: 'Molten cookie skillet 🍪 (restaurant pending verification) #dessert', sponsored: false },
  { key: 'v_food_tour', uploader: 'creator2', restaurant: null, item: null, link: null, caption: 'Brisbane food tour — 5 spots in one night #brisbane #foodtour', sponsored: false },
];
