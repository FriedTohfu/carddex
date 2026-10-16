// Ranks a card's rarity (higher = rarer), from the rarity text in the card list.
const RANKS = [
  [/mega hyper|black white rare|\bbwr\b/i, 100],
  [/hyper rare|\bgold\b|crown|\bhr\b|\bur\b(?!.*ultra)/i, 95],
  [/special illustration|special art|\bsar\b/i, 90],
  [/secret|rainbow|\bsr\b/i, 85],
  [/ultra rare|full art|\brrr\b/i, 80],
  [/illustration rare|art rare|\bar\b|\bchr\b|character/i, 75],
  [/shiny|\bs\b|\bssr\b/i, 72],
  [/double rare|\brr\b/i, 70],
  [/ace spec|radiant|amazing|prism|legend|break|prime|\bstar\b|holo (ex|gx|v|vmax|vstar|lv)/i, 65],
  [/holo|\bk\b/i, 50],
  [/promo/i, 30],
  [/\brare\b|\br\b/i, 40],
  [/uncommon|\bu\b/i, 20],
  [/common|\bc\b/i, 10],
];

export function rarityRank(card) {
  const r = String(card?.det?.rarity || card?.rarity || '').trim();
  if (!r) return 0;
  for (const [re, n] of RANKS) if (re.test(r)) return n;
  return 5;
}
