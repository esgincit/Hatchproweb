// Hatching-egg collection (0039). Offline-capable: queued through the outbox (sync-apply accepts it append-only).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../data/sync/sync_service.dart';
import 'erp_logic.dart';
import 'erp_widgets.dart';

class EggCollectionScreen extends ConsumerStatefulWidget {
  const EggCollectionScreen({super.key});
  @override
  ConsumerState<EggCollectionScreen> createState() => _EggCollectionScreenState();
}

class _EggCollectionScreenState extends ConsumerState<EggCollectionScreen> {
  static const _keys = ['nest', 'floor', 'broken', 'cracked', 'dirty', 'dirty_treated', 'misshapen', 'double_yolk', 'small', 'soft_shell'];
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in _keys) k: TextEditingController()};
  String? _batchId;
  int _no = 1;
  DateTime _date = DateTime.now();
  bool _saving = false;

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  EggCounts get _counts => EggCounts(
      nest: intOf(_c['nest']!.text), floor: intOf(_c['floor']!.text), broken: intOf(_c['broken']!.text),
      cracked: intOf(_c['cracked']!.text), dirty: intOf(_c['dirty']!.text), dirtyTreated: intOf(_c['dirty_treated']!.text),
      misshapen: intOf(_c['misshapen']!.text), doubleYolk: intOf(_c['double_yolk']!.text), small: intOf(_c['small']!.text),
      softShell: intOf(_c['soft_shell']!.text));

  Future<void> _save(String batchId) async {
    if (!_form.currentState!.validate()) return;
    final errs = validateEggs(_counts, _no);
    if (errs.isNotEmpty) { showMsg(context, errs.map((k) => tr(context, k)).join('\n')); return; }
    setState(() => _saving = true);
    try {
      final r = await SyncService.instance.submit('hatching_egg_collection', {
        'batch_id': batchId, 'collected_on': dateStr(_date), 'collection_no': _no,
        for (final k in _keys) k: intOf(_c[k]!.text),
      });
      if (!mounted) return;
      if (r.error != null) { showMsg(context, r.error!); return; }
      showMsg(context, tr(context, r.queued ? 'saved_offline' : 'saved'));
      for (final c in _c.values) { c.clear(); }
      setState(() => _no = (_no % 6) + 1);
    } catch (e) {
      if (mounted) showMsg(context, errText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final flocks = ref.watch(breederFlocksProvider);
    return Scaffold(
      appBar: AppBar(title: Text(tr(context, 'eggs'))),
      body: flocks.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (list) {
          if (list.isEmpty) return Center(child: Text(tr(context, 'none_synced')));
          final id = _batchId ?? list.first.id;
          final c = _counts;
          return Form(key: _form, child: ListView(padding: const EdgeInsets.all(16), children: [
            const SizedBox(height: 12),
            Text(tr(context, 'flock'), style: Theme.of(context).textTheme.labelLarge),
            BatchChips(batches: list, selectedId: id, onSelect: (b) => setState(() => _batchId = b.id)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: DateRow(date: _date, firstDate: list.firstWhere((b) => b.id == id).placedOn, onPick: (d) => setState(() => _date = d))),
              const SizedBox(width: 8),
              Expanded(child: DropdownButtonFormField<int>(
                initialValue: _no, decoration: InputDecoration(labelText: tr(context, 'collection_no')),
                items: [for (var i = 1; i <= 6; i++) DropdownMenuItem(value: i, child: Text('$i'))],
                onChanged: (v) => setState(() => _no = v ?? 1))),
            ]),
            const SizedBox(height: 12),
            GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 2.6, mainAxisSpacing: 8, crossAxisSpacing: 8, children: [
              for (final k in _keys) NumField(_c[k]!, tr(context, k), required: k == 'nest', onChanged: () => setState(() {})),
            ]),
            SettablePreview(settable: settable(c), rejects: c.rejects, floor: c.floor),
            const SizedBox(height: 12),
            FilledButton(onPressed: _saving ? null : () => _save(id), child: Text(tr(context, 'save'))),
          ]));
        },
      ),
    );
  }
}
