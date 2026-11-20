// Candling D10 / D18 (0041). Queued through the outbox (offline-capable). Stage = what already exists on the server;
// when that cannot be read (offline) the user picks the stage and the DB validates it on sync.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/i18n.dart';
import '../../data/sync/sync_service.dart';
import 'erp_logic.dart';
import 'erp_widgets.dart';

class CandlingScreen extends ConsumerStatefulWidget {
  const CandlingScreen({super.key});
  @override
  ConsumerState<CandlingScreen> createState() => _CandlingScreenState();
}

class _CandlingScreenState extends ConsumerState<CandlingScreen> {
  static const _keys = ['eggs_candled', 'infertile', 'early_dead', 'dirty', 'mid_dead', 'late_dead'];
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in _keys) k: TextEditingController()};
  String? _batchId;
  DateTime _date = DateTime.now();
  int? _stage; // null = loading, 0 = both done
  String? _loadError;
  bool _saving = false;

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _pick(String id) async {
    setState(() { _batchId = id; _stage = null; _loadError = null; });
    try {
      final rows = await Supabase.instance.client.from('candling').select('stage').eq('batch_id', id);
      final have = rows.map((r) => r['stage'] as int).toSet();
      if (!mounted || _batchId != id) return;
      setState(() => _stage = !have.contains(1) ? 1 : !have.contains(2) ? 2 : 0);
    } catch (e) {
      if (mounted && _batchId == id) setState(() => _loadError = errText(e));
    }
  }

  Future<void> _save(String id, int eggsSet) async {
    if (!_form.currentState!.validate()) return;
    final stage = _stage!;
    final v = {for (final k in _keys) k: intOf(_c[k]!.text)};
    final errs = validateCandling(stage: stage, eggsSet: eggsSet, candled: v['eggs_candled']!, infertile: v['infertile']!,
        earlyDead: v['early_dead']!, dirty: v['dirty']!, midDead: v['mid_dead']!, lateDead: v['late_dead']!);
    if (errs.isNotEmpty) { showMsg(context, errs.map((k) => tr(context, k)).join('\n')); return; }
    setState(() => _saving = true);
    try {
      final r = await SyncService.instance.submit('candling', {
        'batch_id': id, 'stage': stage, 'candled_on': dateStr(_date), 'eggs_candled': v['eggs_candled'],
        // the DB check wants stage-1 columns null for stage 2 and vice versa
        if (stage == 1) ...{'infertile': v['infertile'], 'early_dead': v['early_dead'], 'dirty': v['dirty']}
        else ...{'mid_dead': v['mid_dead'], 'late_dead': v['late_dead']},
      });
      if (!mounted) return;
      if (r.error != null) { showMsg(context, r.error!); return; }
      showMsg(context, tr(context, r.queued ? 'saved_offline' : 'saved'));
      for (final c in _c.values) { c.clear(); }
      // stage 1 just queued: next entry is stage 2 even if the server cannot confirm yet
      if (r.queued) { setState(() => _stage = stage == 1 ? 2 : 0); return; }
      await _pick(id);
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
      appBar: AppBar(title: Text(tr(context, 'candling'))),
      body: settings.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (list) {
          if (list.isEmpty) return Center(child: Text(tr(context, 'none_synced')));
          final b = list.firstWhere((x) => x.id == _batchId, orElse: () => list.first);
          if (_batchId == null) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted && _batchId == null) _pick(b.id); });
          final stage = _stage;
          return Form(key: _form, child: ListView(padding: const EdgeInsets.all(16), children: [
            Text(tr(context, 'setting'), style: Theme.of(context).textTheme.labelLarge),
            BatchChips(batches: list, selectedId: b.id, onSelect: (x) => _pick(x.id)),
            const SizedBox(height: 12),
            if (stage == null && _loadError != null) ...[
              Text(_loadError!), TextButton(onPressed: () => _pick(b.id), child: Text(tr(context, 'retry'))),
              Wrap(spacing: 8, children: [for (final s in [1, 2]) ChoiceChip(label: Text(tr(context, 'stage$s')), selected: false, onSelected: (_) => setState(() => _stage = s))]),
            ] else if (stage == null) const LinearProgressIndicator()
            else if (stage == 0) Text(tr(context, 'both_done'))
            else ...[
              Text(tr(context, stage == 1 ? 'stage1' : 'stage2'), style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              DateRow(date: _date, firstDate: b.placedOn, onPick: (d) => setState(() => _date = d)),
              const SizedBox(height: 12),
              NumField(_c['eggs_candled']!, tr(context, 'eggs_candled'), required: true, hint: '${b.docCount}'),
              for (final k in stage == 1 ? ['infertile', 'early_dead', 'dirty'] : ['mid_dead', 'late_dead']) ...[
                const SizedBox(height: 8), NumField(_c[k]!, tr(context, k), required: true),
              ],
              const SizedBox(height: 16),
              FilledButton(onPressed: _saving ? null : () => _save(b.id, b.docCount), child: Text(tr(context, 'save'))),
            ],
          ]));
        },
      ),
    );
  }
}
