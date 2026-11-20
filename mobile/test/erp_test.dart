import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:poultryos/core/i18n.dart';
import 'package:poultryos/features/erp/erp_logic.dart';
import 'package:poultryos/features/erp/erp_widgets.dart';

void main() {
  group('settable preview', () {
    test('nest - rejects + treated; floor never counted', () {
      const c = EggCounts(nest: 100, floor: 20, broken: 2, cracked: 3, dirty: 5, dirtyTreated: 4, misshapen: 1, doubleYolk: 1, small: 2, softShell: 1);
      expect(c.rejects, 15);
      expect(settable(c), 100 - 15 + 4);
    });
    test('floor eggs alone are not settable', () => expect(settable(const EggCounts(floor: 50)), 0));
  });

  group('egg validation', () {
    test('ok', () => expect(validateEggs(const EggCounts(nest: 10, broken: 2), 3), isEmpty));
    test('rejects over nest', () => expect(validateEggs(const EggCounts(nest: 5, broken: 6), 1), ['err_rejects']));
    test('treated over dirty', () => expect(validateEggs(const EggCounts(nest: 50, dirty: 1, dirtyTreated: 2), 1), ['err_treated']));
    test('collection no 1-6', () {
      expect(validateEggs(const EggCounts(nest: 5), 0), ['err_collection_no']);
      expect(validateEggs(const EggCounts(nest: 5), 7), ['err_collection_no']);
    });
  });

  test('candling / hatch / delivery validation', () {
    expect(validateCandling(stage: 1, eggsSet: 100, candled: 101), ['err_candled_over']);
    expect(validateCandling(stage: 1, eggsSet: 100, candled: 100, infertile: 60, earlyDead: 30, dirty: 11), ['err_removed_over']);
    expect(validateCandling(stage: 2, eggsSet: 100, candled: 80, midDead: 50, lateDead: 31), ['err_dead_over']);
    expect(validateCandling(stage: 2, eggsSet: 100, candled: 80, midDead: 5, lateDead: 5), isEmpty);
    expect(validateHatch(chicksA: 1, chicksB: 0), ['required']);
    expect(validateHatch(chicksA: 1, chicksB: 0, culls: 0), isEmpty);
    expect(validateDeliveryLine(loaded: 100, delivered: 95, short: 6, doa: 0), ['err_line_over']);
    expect(validateDeliveryLine(loaded: 100, delivered: 95, short: 5, doa: 96), ['err_doa_over']);
    expect(validateDeliveryLine(loaded: 100, delivered: 95, short: 5, doa: 2), isEmpty);
  });

  test('every language has every English key', () {
    final en = i18nTables['en']!.keys.toSet();
    for (final e in i18nTables.entries) {
      expect(e.value.keys.toSet(), en, reason: e.key);
    }
  });

  testWidgets('SettablePreview and NumField render', (t) async {
    final c = TextEditingController();
    final key = GlobalKey<FormState>();
    await t.pumpWidget(MaterialApp(home: Scaffold(body: Form(key: key, child: Column(children: [
      NumField(c, 'Nest', required: true),
      const SettablePreview(settable: 81, rejects: 15, floor: 20),
    ])))));
    expect(find.text('Settable eggs: 81'), findsOneWidget);
    expect(key.currentState!.validate(), isFalse); // required
    await t.enterText(find.byType(TextFormField), '12');
    expect(key.currentState!.validate(), isTrue);
    await t.enterText(find.byType(TextFormField), '-3');
    expect(key.currentState!.validate(), isFalse);
  });
}
