import {sqliteTable,text,index,integer} from 'drizzle-orm/sqlite-core';
// Append-only evidence. JSON stores the complete versioned contract; indexed
// columns support the actual board/evidence/export queries.
export const events=sqliteTable('events',{
 id:text('id').primaryKey(),sport:text('sport').notNull(),league:text('league').notNull(),
 startAt:text('start_at').notNull(),data:text('data').notNull(),createdAt:text('created_at').notNull()
},t=>[index('events_start').on(t.startAt)]);
export const markets=sqliteTable('markets',{
 id:text('id').primaryKey(),eventId:text('event_id').notNull().references(()=>events.id),data:text('data').notNull()
},t=>[index('markets_event').on(t.eventId)]);
export const offers=sqliteTable('offers',{
 id:text('id').primaryKey(),data:text('data').notNull(),createdAt:text('created_at').notNull()
});
export const snapshots=sqliteTable('quote_snapshots',{
 id:text('id').primaryKey(),eventId:text('event_id').notNull().references(()=>events.id),marketId:text('market_id').notNull().references(()=>markets.id),offerId:text('offer_id').notNull().references(()=>offers.id),observedAt:text('observed_at').notNull(),rawHash:text('raw_hash').notNull(),data:text('data').notNull()
},t=>[index('snapshots_offer_time').on(t.offerId,t.observedAt),index('snapshots_market_time').on(t.marketId,t.observedAt)]);
export const predictions=sqliteTable('predictions',{
 id:text('id').primaryKey(),eventId:text('event_id').notNull().references(()=>events.id),marketId:text('market_id').notNull().references(()=>markets.id),offerId:text('offer_id').notNull().references(()=>offers.id),snapshotId:text('snapshot_id').notNull().references(()=>snapshots.id),asOf:text('as_of').notNull(),modelVersion:text('model_version'),eligibility:text('eligibility').notNull(),data:text('data').notNull()
},t=>[index('predictions_market_time').on(t.marketId,t.asOf),index('predictions_time').on(t.asOf)]);
export const resultRevisions=sqliteTable('result_revisions',{
 id:text('id').primaryKey(),sourceKey:text('source_key').notNull(),offerId:text('offer_id'),eventId:text('event_id'),marketId:text('market_id'),knownAt:text('known_at').notNull(),status:text('status').notNull(),rawHash:text('raw_hash').notNull(),data:text('data').notNull()
},t=>[index('results_source_time').on(t.sourceKey,t.knownAt),index('results_market_time').on(t.marketId,t.knownAt)]);
export const evaluations=sqliteTable('evaluations',{
 id:text('id').primaryKey(),createdAt:text('created_at').notNull(),modelVersion:text('model_version'),data:text('data').notNull()
});
export const collections=sqliteTable('collections',{
 id:text('id').primaryKey(),observedAt:text('observed_at').notNull(),rawHash:text('raw_hash').notNull(),data:text('data').notNull()
});
// Operational lease only; it contains no statistical evidence.
export const collectionLocks=sqliteTable('collection_locks',{
 id:text('id').primaryKey(),expiresAt:integer('expires_at').notNull(),token:text('token').notNull()
});
export const pickSlips=sqliteTable('pick_slips',{
 id:text('id').primaryKey(),createdAt:text('created_at').notNull(),data:text('data').notNull()
},t=>[index('pick_slips_created').on(t.createdAt)]);
