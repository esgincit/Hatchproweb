// Hatch result (0042 / 0044). Online-only. New settings need an approved setter-to-hatcher transfer: the DB message is shown.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/i18n.dart';
import 'erp_logic.dart';
import 'erp_widgets.dart';

class HatchScreen extends ConsumerStatefulWidget {
  const HatchScreen({super.key});
  @override
  ConsumerState<HatchScreen> createState() => _HatchScreenState();
}

class _HatchScreenState extends ConsumerState<HatchScreen> {
  static const _keys = ['chicks_a', 'chicks_b', 'culls', 'dead_in_hatcher', 'unhatched'];
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in _keys) k: TextEditingController()};
  String? _batchId;
  DateTime _date = DateTime.now();
  bool _saving = false;

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save(String id) async {
    if (!_form.currentState!.validate()) return;
    final errs = validateHatch(chicksA: intOrNull(_c['chicks_a']!.text), chicksB: intOrNull(_c['chicks_b']!.text), culls: intOrNull(_c['culls']!.text));
    if (errs.isNotEmpty) { showMsg(context, errs.map((k) => tr(context, k)).join('\n')); return; }
    setState(() => _saving = true);
    try {
      // batch_id is the primary key: upsert so an existing (e.g. legacy candling-only) row is completed, not duplicated
      await Supabase.instance.client.from('hatch_record').upsert({
        'batch_id': id, 'hatched_on': dateStr(_date), 'chicks_a': intOf(_c['chicks_a']!.text), 'chicks_b': intOf(_c['chicks_b']!.text),
        'culls': intOf(_c['culls']!.text), 'dead_in_hatcher': intOrNull(_c['dead_in_hatcher']!.text), 'unhatched': intOrNull(_c['unhatched']!.text),
      }, onConflict: 'batch_id');
      if (!mounted) return;
      showMsg(context, tr(context, 'saved'));
      for (final c in _c.values) { c.clear(); }
    } catch (e) {
      if (mounted) showMsg(context, errText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(hatcherySettingsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(tr(context, 'hatch'))),
      body: settings.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (list) {
          if (list.isEmpty) return Center(child: Text(tr(context, 'none_synced')));
          final b = list.firstWhere((x) => x.id == _batchId, orElse: () => list.first);
          return Form(key: _form, child: ListView(padding: const EdgeInsets.all(16), children: [
            const NeedsInternetBanner(),
            const SizedBox(height: 12),
            Text(tr(context, 'setting'), style: Theme.of(context).textTheme.labelLarge),
            BatchChips(batches: list, selectedId: b.id, onSelect: (x) => setState(() => _batchId = x.id)),
            const SizedBox(height: 12),
            DateRow(date: _date, firstDate: b.placedOn, onPick: (d) => setState(() => _date = d)),
            for (final k in _keys) ...[
              const SizedBox(height: 8), NumField(_c[k]!, tr(context, k), required: k == 'chicks_a' || k == 'chicks_b' || k == 'culls'),
            ],
            const SizedBox(height: 16),
            FilledButton(onPressed: _saving ? null : () => _save(b.id), child: Text(tr(context, 'save'))),
          ]));
        },
      ),
    );
  }
}
