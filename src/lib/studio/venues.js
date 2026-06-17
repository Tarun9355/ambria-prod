// Venue reference data (faithful to the reference Studio app).
// NOTE: The live venue lists (allInhouseVenues / allOutdoorDB / allVenueData)
// in the reference are component-scope useMemo values derived from React state
// (customInhouse / customOutdoor), so they are NOT pure module-scope data and
// cannot be extracted here. The only module-scope venue data are the legacy
// migration seed + its migration flag, copied verbatim below.

export const VENUE_MIG_SK = "ambria-venues-migrated-v1";
// Legacy venue seeds (from original hardcoded VENUES/VENUE_DATA/INHOUSE_VENUES/OUTDOOR_VENUE_DB).
// Used ONLY by the one-time migration on first load after this refactor. Once the flag
// VENUE_MIG_SK is set in Redis, these are never referenced again — venues are fully
// admin-managed via the Venues tab.
export const LEGACY_VENUE_SEED = {
  inhouse: [
    {name:"Emerald Green",base:80000,label:"Premium Lawn",type:"Outdoor",parent:"Manaktala",manager:"Aman",icon:"🏛️",desc:"Premium lawn & intimate garden"},
    {name:"Alstonia",base:50000,label:"Intimate Lawn",type:"Outdoor",parent:"Manaktala",manager:"Aman",icon:"🏛️",desc:"Premium lawn & intimate garden"},
    {name:"Aura",base:95000,label:"Premium Banquet",type:"Indoor",parent:"Exotica",manager:"Anmol",icon:"✨",desc:"Banquets & poolside"},
    {name:"Valencia",base:70000,label:"Classic Banquet",type:"Indoor",parent:"Exotica",manager:"Anmol",icon:"✨",desc:"Banquets & poolside"},
    {name:"Poolside",base:65000,label:"Water Feature",type:"Semi-Outdoor",parent:"Exotica",manager:"Anmol",icon:"✨",desc:"Banquets & poolside"},
    {name:"Pushpanjali",base:120000,label:"Grand Lawn",type:"Outdoor",parent:"Pushpanjali",manager:"Ashi",icon:"👑",desc:"Grand premium lawn"},
  ],
  outdoor: [
    {name:"Grand Vasantkunj",empanelled:true},{name:"Country Inn",empanelled:true},{name:"Kaara Farm",empanelled:true},
    {name:"Sunday Resort",empanelled:true},{name:"Radisson UV",empanelled:true},{name:"Taj Vivanta",empanelled:true},
    {name:"Pride Plaza",empanelled:true},{name:"Sarovar Portico",empanelled:true},
    {name:"Palasa",empanelled:false},{name:"Canvas",empanelled:false},{name:"Tivoli Grand",empanelled:false},
    {name:"Westin",empanelled:false},{name:"Sanskriti",empanelled:false},
  ],
};
