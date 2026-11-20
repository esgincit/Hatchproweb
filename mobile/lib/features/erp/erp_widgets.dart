// Small shared pieces for the ERP field screens.
import 'package:drift/drift.dart' show BooleanExpressionOperators;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n.dart';
import '../../data/local/app_db.dart';

/// Open flocks / settings from the local mirror (works offline; the form itself needs internet).
final breederFlocksProvider = StreamProvider.autoDispose((ref) => (AppDb.instance.select(AppDb.instance.batches)
  ..where((b) => b.state.isNotIn(['closed']) & b.farmType.equals('breeder'))).watch());
final hatcherySettingsProvider = StreamProvider.autoDispose((ref) => (AppDb.instance.select(AppDb.instance.batches)
  ..where((b) => b.state.isNotIn(['closed']) & b.farmType.equals('hatchery'))).watch());

String dateStr(DateTime d) => d.toIso8601String().substring(0, 10);

int? intOrNull(String s) => int.tryParse(s.trim());
int intOf(String s) => intOrNull(s) ?? 0;

class NumField extends StatelessWidget {
  const NumField(this.controller, this.label, {super.key, this.onChanged, this.required = false, this.hint});
  final TextEditingController controller;
  final String label;
  final VoidCallback? onChanged;
  final bool required;
  final String? hint;
  @override
  Widget build(BuildContext context) => TextFormField(
        controller: controller,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: label, hintText: hint),
        onChanged: (_) => onChanged?.call(),
        validator: (s) {
          final v = s?.trim() ?? '';
          if (v.isEmpty) return required ? tr(context, 'required') : null;
          final n = int.tryParse(v);
          return n == null || n < 0 ? '≥ 0' : null;
        },
      );
}

class NeedsInternetBanner extends StatelessWidget {
  const NeedsInternetBanner({super.key});
  @override
  Widget build(BuildContext context) => Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [
        const Icon(Icons.wifi_off_outlined), const SizedBox(width: 8), Expanded(child: Text(tr(context, 'needs_internet')))])));
}

class DateRow extends StatelessWidget {
  const DateRow({super.key, required this.date, required this.firstDate, required this.onPick});
  final DateTime date, firstDate;
  final ValueChanged<DateTime> onPick;
  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        icon: const Icon(Icons.event),
        label: Text(dateStr(date)),
        onPressed: () async {
          final now = DateTime.now();
          final d = await showDatePicker(context: context, initialDate: date, firstDate: firstDate, lastDate: now);
          if (d != null) onPick(d);
        },
      );
}

/// Flat chip row to choose one flock / setting.
class BatchChips extends StatelessWidget {
  const BatchChips({super.key, required this.batches, required this.selectedId, required this.onSelect});
  final List<Batche> batches;
  final String? selectedId;
  final ValueChanged<Batche> onSelect;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, children: [
        for (final b in batches) ChoiceChip(label: Text(b.code), selected: b.id == selectedId, onSelected: (_) => onSelect(b)),
      ]);
}

/// Live "settable = nest - rejects + treated" read-out under the egg counts.
class SettablePreview extends StatelessWidget {
  const SettablePreview({super.key, required this.settable, required this.rejects, required this.floor});
  final int settable, rejects, floor;
  @override
  Widget build(BuildContext context) {
    final bad = settable < 0;
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${tr(context, 'settable')}: $settable',
          key: const Key('settable-value'),
          style: Theme.of(context).textTheme.titleLarge?.copyWith(color: bad ? Theme.of(context).colorScheme.error : null)),
      Text('${tr(context, 'rejects')}: $rejects · ${tr(context, 'floor')}: $floor'),
      Text(tr(context, 'floor_note'), style: Theme.of(context).textTheme.bodySmall),
    ])));
  }
}

void showMsg(BuildContext context, String msg) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
