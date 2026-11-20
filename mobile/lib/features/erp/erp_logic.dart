// Pure calculations + validation for the ERP field forms (unit-tested; no Flutter / Supabase imports).

class EggCounts {
  const EggCounts({this.nest = 0, this.floor = 0, this.broken = 0, this.cracked = 0, this.dirty = 0,
    this.dirtyTreated = 0, this.misshapen = 0, this.doubleYolk = 0, this.small = 0, this.softShell = 0});
  final int nest, floor, broken, cracked, dirty, dirtyTreated, misshapen, doubleYolk, small, softShell;
  int get rejects => broken + cracked + dirty + misshapen + doubleYolk + small + softShell;
}

/// Mirrors hatching_egg_check() (0039): settable = nest - rejects + dirty_treated. Floor eggs are not settable
/// unless the tenant rule floor_eggs_settable is on (the phone assumes the default; the DB has the final say).
int settable(EggCounts c) => c.nest - c.rejects + c.dirtyTreated;

/// Error keys (see i18n.dart); an empty list means the form may be sent.
List<String> validateEggs(EggCounts c, int collectionNo) => [
  if (collectionNo < 1 || collectionNo > 6) 'err_collection_no',
  if (c.dirtyTreated > c.dirty) 'err_treated',
  if (c.rejects > c.nest) 'err_rejects',
];

List<String> validateCandling({required int stage, required int eggsSet, required int candled,
    int infertile = 0, int earlyDead = 0, int dirty = 0, int midDead = 0, int lateDead = 0}) => [
  if (candled > eggsSet) 'err_candled_over',
  if (stage == 1 && infertile + earlyDead + dirty > eggsSet) 'err_removed_over',
  if (stage == 2 && midDead + lateDead > candled) 'err_dead_over',
];

List<String> validateHatch({int? chicksA, int? chicksB, int? culls}) => [
  if (chicksA == null || chicksB == null || culls == null) 'required',
];

/// qty_delivered + qty_short <= qty_loaded and qty_doa <= qty_delivered (dispatch_line checks, 0045).
List<String> validateDeliveryLine({required int loaded, required int delivered, required int short, required int doa}) => [
  if (delivered + short > loaded) 'err_line_over',
  if (doa > delivered) 'err_doa_over',
];
