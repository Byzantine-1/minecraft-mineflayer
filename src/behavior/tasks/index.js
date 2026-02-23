const gatherFood = require('./gatherFood')
const chopWood = require('./chopWood')
const mineOre = require('./mineOre')
const patrol = require('./patrol')
const guardChurch = require('./guardChurch')
const attendService = require('./attendService')
const healRest = require('./healRest')
const fleeShelter = require('./fleeShelter')
const workTrade = require('./workTrade')
const escortCaravan = require('./escortCaravan')
const raidDefense = require('./raidDefense')
const diplomacy = require('./diplomacy')

const TASK_MODULES = {
  [gatherFood.id]: gatherFood,
  [chopWood.id]: chopWood,
  [mineOre.id]: mineOre,
  [patrol.id]: patrol,
  [guardChurch.id]: guardChurch,
  [attendService.id]: attendService,
  [healRest.id]: healRest,
  [fleeShelter.id]: fleeShelter,
  [workTrade.id]: workTrade,
  [escortCaravan.id]: escortCaravan,
  [raidDefense.id]: raidDefense,
  [diplomacy.id]: diplomacy
}

module.exports = {
  TASK_MODULES
}
