// Driver deliveries (0045): trips on the road (dispatch.status = approved) -> delivered/short/DOA per line -> mark delivered.
// Online-only. Optional proof photo goes to the private `evidence` bucket (0027) under <tenant>/dispatch/<id>/.
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/i18n.dart';
import 'erp_logic.dart';
import 'erp_widgets.dart';

final tripsProvider = FutureProvider.autoDispose((ref) async => await Supabase.instance.client
    .from('dispatch')
    .select('id, dispatch_no, route, planned_on, dispatch_line(id, qty_loaded, order_allocation(sales_order(order_no, customer(name))))')
    .eq('status', 'approved')
    .order('planned_on'));

class DeliveriesScreen extends ConsumerWidget {
  const DeliveriesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: Text(tr(context, 'deliveries'))),
        body: ref.watch(tripsProvider).when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                Padding(padding: const EdgeInsets.all(16), child: Text(errText(e))),
                TextButton(onPressed: () => ref.invalidate(tripsProvider), child: Text(tr(context, 'retry'))),
              ])),
              data: (trips) => trips.isEmpty
                  ? Center(child: Text(tr(context, 'no_trips')))
                  : RefreshIndicator(
                      onRefresh: () async => ref.refresh(tripsProvider.future),
                      child: ListView(padding: const EdgeInsets.all(12), children: [
                        const NeedsInternetBanner(),
                        for (final t in trips) _TripCard(key: ValueKey(t['id']), trip: t, onDone: () => ref.invalidate(tripsProvider)),
                      ])),
            ),
      );
}

class _TripCard extends StatefulWidget {
  const _TripCard({super.key, required this.trip, required this.onDone});
  final Map<String, dynamic> trip;
  final VoidCallback onDone;
  @override
  State<_TripCard> createState() => _TripCardState();
}

class _TripCardState extends State<_TripCard> {
  final _form = GlobalKey<FormState>();
  final _receiver = TextEditingController();
  late final List<Map<String, dynamic>> _lines = (widget.trip['dispatch_line'] as List).cast<Map<String, dynamic>>();
  // per line: delivered (defaults to loaded), short, doa
  late final Map<String, List<TextEditingController>> _c = {
    for (final l in _lines) l['id']: [TextEditingController(text: '${l['qty_loaded']}'), TextEditingController(text: '0'), TextEditingController(text: '0')],
  };
  File? _photo;
  bool _saving = false;

  @override
  void dispose() {
    _receiver.dispose();
    for (final cs in _c.values) { for (final c in cs) { c.dispose(); } }
    super.dispose();
  }

  Future<void> _capture() async {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 1600);
    if (x != null) setState(() => _photo = File(x.path));
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final errs = <String>{};
    for (final l in _lines) {
      final cs = _c[l['id']]!;
      errs.addAll(validateDeliveryLine(loaded: l['qty_loaded'], delivered: intOf(cs[0].text), short: intOf(cs[1].text), doa: intOf(cs[2].text)));
    }
    if (errs.isNotEmpty) { showMsg(context, errs.map((k) => tr(context, k)).join('\n')); return; }
    setState(() => _saving = true);
    try {
      final sb = Supabase.instance.client;
      String? podPath;
      if (_photo != null) {
        final tenant = sb.auth.currentUser!.appMetadata['tenant_id'];
        podPath = '$tenant/dispatch/${widget.trip['id']}/${const Uuid().v4()}.jpg';
        await sb.storage.from('evidence').upload(podPath, _photo!);
      }
      for (final l in _lines) {
        final cs = _c[l['id']]!;
        await sb.from('dispatch_line').update({'qty_delivered': intOf(cs[0].text), 'qty_short': intOf(cs[1].text), 'qty_doa': intOf(cs[2].text)}).eq('id', l['id']);
      }
      await sb.from('dispatch').update({'status': 'delivered', 'receiver_name': _receiver.text.trim(), if (podPath != null) 'pod_path': podPath}).eq('id', widget.trip['id']);
      if (!mounted) return;
      showMsg(context, tr(context, 'delivered_ok'));
      widget.onDone();
    } catch (e) {
      if (mounted) showMsg(context, errText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.trip;
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Form(key: _form, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${t['dispatch_no']}', style: Theme.of(context).textTheme.titleMedium),
      if (t['route'] != null) Text('${t['route']}'),
      for (final l in _lines) ...[
        const Divider(height: 24),
        Text('${l['order_allocation']?['sales_order']?['order_no'] ?? ''} · ${l['order_allocation']?['sales_order']?['customer']?['name'] ?? ''}'),
        Text('${tr(context, 'loaded')}: ${l['qty_loaded']}'),
        const SizedBox(height: 8),
        Row(children: [
          for (final (i, k) in ['delivered', 'short', 'doa'].indexed) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(child: NumField(_c[l['id']]![i], tr(context, k), required: true)),
          ],
        ]),
      ],
      const Divider(height: 24),
      TextFormField(controller: _receiver, decoration: InputDecoration(labelText: tr(context, 'receiver')),
          validator: (s) => (s ?? '').trim().isEmpty ? tr(context, 'required') : null),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        if (_photo != null) ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(_photo!, width: 96, height: 72, fit: BoxFit.cover)),
        OutlinedButton.icon(onPressed: _capture, icon: const Icon(Icons.photo_camera_outlined), label: Text(tr(context, 'photo'))),
      ]),
      const SizedBox(height: 12),
      FilledButton(onPressed: _saving ? null : _submit, child: Text(tr(context, 'mark_delivered'))),
    ]))));
  }
}
