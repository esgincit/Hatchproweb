// Minimal string table: the app has no ARB/gen-l10n setup yet, so the ERP screens carry their own
// en/te/hi/ta/kn strings. A missing key or unsupported locale (e.g. mr) falls back to English.
import 'package:flutter/widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _en = <String, String>{
  'eggs': 'Hatching eggs', 'candling': 'Candling', 'hatch': 'Hatch result', 'deliveries': 'Deliveries',
  'flock': 'Breeder flock', 'setting': 'Setting', 'collection_no': 'Collection no.', 'nest': 'Nest eggs', 'floor': 'Floor eggs',
  'broken': 'Broken', 'cracked': 'Cracked', 'dirty': 'Dirty', 'dirty_treated': 'Dirty, treated', 'misshapen': 'Misshapen',
  'double_yolk': 'Double yolk', 'small': 'Small', 'soft_shell': 'Soft shell',
  'settable': 'Settable eggs', 'rejects': 'Rejects', 'floor_note': 'Floor eggs are not settable',
  'save': 'Save', 'saved': 'Saved', 'needs_internet': 'Needs internet: this form is sent directly and is not queued offline.',
  'none_synced': 'Nothing synced yet. Sync from More first.', 'required': 'Required',
  'err_collection_no': 'Collection number must be 1 to 6', 'err_treated': 'Treated dirty eggs exceed dirty eggs',
  'err_rejects': 'Rejects exceed nest eggs', 'err_candled_over': 'Candled more than the eggs set',
  'err_removed_over': 'Removed eggs exceed eggs set', 'err_dead_over': 'Dead embryos exceed eggs candled',
  'err_line_over': 'Delivered + short exceeds loaded', 'err_doa_over': 'DOA exceeds delivered',
  'stage1': 'Candling day 10', 'stage2': 'Candling day 18', 'both_done': 'Both candlings are already recorded for this setting.',
  'eggs_candled': 'Eggs candled', 'infertile': 'Infertile', 'early_dead': 'Early dead', 'mid_dead': 'Mid dead', 'late_dead': 'Late dead',
  'chicks_a': 'Chicks grade A', 'chicks_b': 'Chicks grade B', 'culls': 'Culls', 'dead_in_hatcher': 'Dead in hatcher', 'unhatched': 'Unhatched',
  'no_trips': 'No trips on the road.', 'loaded': 'Loaded', 'delivered': 'Delivered', 'short': 'Short', 'doa': 'DOA',
  'receiver': 'Received by', 'photo': 'Proof photo', 'mark_delivered': 'Mark delivered', 'retry': 'Retry', 'delivered_ok': 'Trip marked delivered',
};
const _te = <String, String>{
  'eggs': 'హ్యాచింగ్ గుడ్లు', 'candling': 'క్యాండ్లింగ్', 'hatch': 'పొదిగిన ఫలితం', 'deliveries': 'డెలివరీలు',
  'flock': 'బ్రీడర్ మంద', 'setting': 'సెట్టింగ్', 'collection_no': 'సేకరణ సంఖ్య', 'nest': 'గూటి గుడ్లు', 'floor': 'నేల గుడ్లు',
  'broken': 'పగిలినవి', 'cracked': 'పగుళ్లు', 'dirty': 'మురికి', 'dirty_treated': 'మురికి, శుద్ధి చేసినవి', 'misshapen': 'వికృత ఆకారం',
  'double_yolk': 'రెండు సొనలు', 'small': 'చిన్నవి', 'soft_shell': 'మెత్తని పెంకు',
  'settable': 'సెట్ చేయదగిన గుడ్లు', 'rejects': 'తిరస్కరణలు', 'floor_note': 'నేల గుడ్లు సెట్ చేయరాదు',
  'save': 'సేవ్', 'saved': 'సేవ్ అయింది', 'needs_internet': 'ఇంటర్నెట్ అవసరం: ఈ ఫారం నేరుగా పంపబడుతుంది, ఆఫ్‌లైన్‌లో నిల్వ కాదు.',
  'none_synced': 'ఇంకా సింక్ కాలేదు. ముందుగా More నుండి సింక్ చేయండి.', 'required': 'అవసరం',
  'err_collection_no': 'సేకరణ సంఖ్య 1 నుండి 6 వరకు', 'err_treated': 'శుద్ధి చేసిన గుడ్లు మురికి గుడ్ల కంటే ఎక్కువ',
  'err_rejects': 'తిరస్కరణలు గూటి గుడ్ల కంటే ఎక్కువ', 'err_candled_over': 'సెట్ చేసిన గుడ్ల కంటే ఎక్కువ పరీక్షించారు',
  'err_removed_over': 'తొలగించిన గుడ్లు సెట్ చేసిన వాటి కంటే ఎక్కువ', 'err_dead_over': 'చనిపోయిన పిండాలు పరీక్షించిన గుడ్ల కంటే ఎక్కువ',
  'err_line_over': 'డెలివరీ + తక్కువ లోడ్ కంటే ఎక్కువ', 'err_doa_over': 'DOA డెలివరీ కంటే ఎక్కువ',
  'stage1': 'క్యాండ్లింగ్ 10వ రోజు', 'stage2': 'క్యాండ్లింగ్ 18వ రోజు', 'both_done': 'ఈ సెట్టింగ్‌కు రెండు క్యాండ్లింగ్‌లు నమోదయ్యాయి.',
  'eggs_candled': 'పరీక్షించిన గుడ్లు', 'infertile': 'ఫలదీకరణ కానివి', 'early_dead': 'ముందే చనిపోయినవి', 'mid_dead': 'మధ్యలో చనిపోయినవి', 'late_dead': 'ఆలస్యంగా చనిపోయినవి',
  'chicks_a': 'పిల్లలు గ్రేడ్ A', 'chicks_b': 'పిల్లలు గ్రేడ్ B', 'culls': 'కల్స్', 'dead_in_hatcher': 'హ్యాచర్‌లో చనిపోయినవి', 'unhatched': 'పొదగనివి',
  'no_trips': 'రోడ్డుపై ట్రిప్‌లు లేవు.', 'loaded': 'లోడ్', 'delivered': 'డెలివరీ', 'short': 'తక్కువ', 'doa': 'DOA',
  'receiver': 'స్వీకర్త పేరు', 'photo': 'రుజువు ఫోటో', 'mark_delivered': 'డెలివరీ అయినట్లు గుర్తించండి', 'retry': 'మళ్లీ ప్రయత్నించండి', 'delivered_ok': 'ట్రిప్ డెలివరీ అయింది',
};
const _hi = <String, String>{
  'eggs': 'हैचिंग अंडे', 'candling': 'कैंडलिंग', 'hatch': 'हैच परिणाम', 'deliveries': 'डिलीवरी',
  'flock': 'ब्रीडर झुंड', 'setting': 'सेटिंग', 'collection_no': 'संग्रह संख्या', 'nest': 'नेस्ट अंडे', 'floor': 'फर्श के अंडे',
  'broken': 'टूटे', 'cracked': 'दरार वाले', 'dirty': 'गंदे', 'dirty_treated': 'गंदे, साफ किए', 'misshapen': 'बेडौल',
  'double_yolk': 'दो जर्दी', 'small': 'छोटे', 'soft_shell': 'नरम खोल',
  'settable': 'सेट करने योग्य अंडे', 'rejects': 'रिजेक्ट', 'floor_note': 'फर्श के अंडे सेट नहीं होते',
  'save': 'सेव करें', 'saved': 'सेव हो गया', 'needs_internet': 'इंटरनेट चाहिए: यह फॉर्म सीधे भेजा जाता है, ऑफलाइन कतार में नहीं।',
  'none_synced': 'अभी कुछ सिंक नहीं हुआ। पहले More से सिंक करें।', 'required': 'आवश्यक',
  'err_collection_no': 'संग्रह संख्या 1 से 6 होनी चाहिए', 'err_treated': 'साफ किए अंडे गंदे अंडों से ज्यादा हैं',
  'err_rejects': 'रिजेक्ट नेस्ट अंडों से ज्यादा हैं', 'err_candled_over': 'सेट किए अंडों से ज्यादा कैंडल किए',
  'err_removed_over': 'निकाले अंडे सेट अंडों से ज्यादा हैं', 'err_dead_over': 'मृत भ्रूण कैंडल किए अंडों से ज्यादा हैं',
  'err_line_over': 'डिलीवर + कम, लोड से ज्यादा है', 'err_doa_over': 'DOA डिलीवर से ज्यादा है',
  'stage1': 'कैंडलिंग दिन 10', 'stage2': 'कैंडलिंग दिन 18', 'both_done': 'इस सेटिंग की दोनों कैंडलिंग दर्ज हैं।',
  'eggs_candled': 'कैंडल किए अंडे', 'infertile': 'अनिषेचित', 'early_dead': 'शुरुआती मृत', 'mid_dead': 'मध्य मृत', 'late_dead': 'देर से मृत',
  'chicks_a': 'चूजे ग्रेड A', 'chicks_b': 'चूजे ग्रेड B', 'culls': 'कल्स', 'dead_in_hatcher': 'हैचर में मृत', 'unhatched': 'न निकले',
  'no_trips': 'सड़क पर कोई ट्रिप नहीं।', 'loaded': 'लोड', 'delivered': 'डिलीवर', 'short': 'कम', 'doa': 'DOA',
  'receiver': 'प्राप्तकर्ता', 'photo': 'प्रमाण फोटो', 'mark_delivered': 'डिलीवर दर्ज करें', 'retry': 'फिर कोशिश करें', 'delivered_ok': 'ट्रिप डिलीवर दर्ज हुई',
};
const _ta = <String, String>{
  'eggs': 'பொரிப்பு முட்டைகள்', 'candling': 'கேண்ட்லிங்', 'hatch': 'பொரிப்பு முடிவு', 'deliveries': 'டெலிவரிகள்',
  'flock': 'இனப்பெருக்க மந்தை', 'setting': 'செட்டிங்', 'collection_no': 'சேகரிப்பு எண்', 'nest': 'கூடு முட்டைகள்', 'floor': 'தரை முட்டைகள்',
  'broken': 'உடைந்தவை', 'cracked': 'விரிசல்', 'dirty': 'அழுக்கு', 'dirty_treated': 'அழுக்கு, சுத்தம் செய்தவை', 'misshapen': 'வடிவம் கெட்டவை',
  'double_yolk': 'இரட்டை மஞ்சள் கரு', 'small': 'சிறியவை', 'soft_shell': 'மென்மையான ஓடு',
  'settable': 'செட் செய்யக்கூடிய முட்டைகள்', 'rejects': 'நிராகரிப்பு', 'floor_note': 'தரை முட்டைகள் செட் செய்யப்படாது',
  'save': 'சேமி', 'saved': 'சேமிக்கப்பட்டது', 'needs_internet': 'இணையம் தேவை: இந்தப் படிவம் நேரடியாக அனுப்பப்படும், ஆஃப்லைனில் சேமிக்கப்படாது.',
  'none_synced': 'இன்னும் ஒத்திசைக்கவில்லை. முதலில் More-இல் ஒத்திசைக்கவும்.', 'required': 'அவசியம்',
  'err_collection_no': 'சேகரிப்பு எண் 1 முதல் 6 வரை', 'err_treated': 'சுத்தம் செய்தவை அழுக்கு முட்டைகளை விட அதிகம்',
  'err_rejects': 'நிராகரிப்பு கூடு முட்டைகளை விட அதிகம்', 'err_candled_over': 'செட் செய்ததை விட அதிகமாக சோதித்தது',
  'err_removed_over': 'நீக்கிய முட்டைகள் செட் செய்ததை விட அதிகம்', 'err_dead_over': 'இறந்த கருக்கள் சோதித்த முட்டைகளை விட அதிகம்',
  'err_line_over': 'டெலிவரி + குறைவு ஏற்றியதை விட அதிகம்', 'err_doa_over': 'DOA டெலிவரியை விட அதிகம்',
  'stage1': 'கேண்ட்லிங் நாள் 10', 'stage2': 'கேண்ட்லிங் நாள் 18', 'both_done': 'இந்த செட்டிங்கிற்கு இரு கேண்ட்லிங்கும் பதிவாகிவிட்டன.',
  'eggs_candled': 'சோதித்த முட்டைகள்', 'infertile': 'கருவுறாதவை', 'early_dead': 'ஆரம்பத்தில் இறந்தவை', 'mid_dead': 'நடுவில் இறந்தவை', 'late_dead': 'தாமதமாக இறந்தவை',
  'chicks_a': 'குஞ்சுகள் தரம் A', 'chicks_b': 'குஞ்சுகள் தரம் B', 'culls': 'கல்ஸ்', 'dead_in_hatcher': 'ஹாட்சரில் இறந்தவை', 'unhatched': 'பொரியாதவை',
  'no_trips': 'சாலையில் பயணங்கள் இல்லை.', 'loaded': 'ஏற்றியது', 'delivered': 'டெலிவரி', 'short': 'குறைவு', 'doa': 'DOA',
  'receiver': 'பெற்றவர் பெயர்', 'photo': 'சான்று புகைப்படம்', 'mark_delivered': 'டெலிவரி ஆனதாக குறி', 'retry': 'மீண்டும் முயற்சி', 'delivered_ok': 'பயணம் டெலிவரி ஆனது',
};
const _kn = <String, String>{
  'eggs': 'ಹ್ಯಾಚಿಂಗ್ ಮೊಟ್ಟೆಗಳು', 'candling': 'ಕ್ಯಾಂಡ್ಲಿಂಗ್', 'hatch': 'ಮರಿ ಹೊರಬರುವ ಫಲಿತಾಂಶ', 'deliveries': 'ಡೆಲಿವರಿಗಳು',
  'flock': 'ಬ್ರೀಡರ್ ಹಿಂಡು', 'setting': 'ಸೆಟ್ಟಿಂಗ್', 'collection_no': 'ಸಂಗ್ರಹ ಸಂಖ್ಯೆ', 'nest': 'ಗೂಡಿನ ಮೊಟ್ಟೆಗಳು', 'floor': 'ನೆಲದ ಮೊಟ್ಟೆಗಳು',
  'broken': 'ಒಡೆದವು', 'cracked': 'ಬಿರುಕು', 'dirty': 'ಕೊಳಕು', 'dirty_treated': 'ಕೊಳಕು, ಶುದ್ಧೀಕರಿಸಿದ್ದು', 'misshapen': 'ವಿಕಾರ ಆಕಾರ',
  'double_yolk': 'ಎರಡು ಹಳದಿ', 'small': 'ಸಣ್ಣವು', 'soft_shell': 'ಮೃದು ಚಿಪ್ಪು',
  'settable': 'ಸೆಟ್ ಮಾಡಬಹುದಾದ ಮೊಟ್ಟೆಗಳು', 'rejects': 'ತಿರಸ್ಕೃತ', 'floor_note': 'ನೆಲದ ಮೊಟ್ಟೆಗಳನ್ನು ಸೆಟ್ ಮಾಡುವುದಿಲ್ಲ',
  'save': 'ಉಳಿಸಿ', 'saved': 'ಉಳಿಸಲಾಗಿದೆ', 'needs_internet': 'ಇಂಟರ್ನೆಟ್ ಬೇಕು: ಈ ಫಾರ್ಮ್ ನೇರವಾಗಿ ಕಳುಹಿಸಲ್ಪಡುತ್ತದೆ, ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಸಂಗ್ರಹವಾಗುವುದಿಲ್ಲ.',
  'none_synced': 'ಇನ್ನೂ ಸಿಂಕ್ ಆಗಿಲ್ಲ. ಮೊದಲು More ನಿಂದ ಸಿಂಕ್ ಮಾಡಿ.', 'required': 'ಅಗತ್ಯ',
  'err_collection_no': 'ಸಂಗ್ರಹ ಸಂಖ್ಯೆ 1 ರಿಂದ 6', 'err_treated': 'ಶುದ್ಧೀಕರಿಸಿದವು ಕೊಳಕು ಮೊಟ್ಟೆಗಳಿಗಿಂತ ಹೆಚ್ಚು',
  'err_rejects': 'ತಿರಸ್ಕೃತ ಗೂಡಿನ ಮೊಟ್ಟೆಗಳಿಗಿಂತ ಹೆಚ್ಚು', 'err_candled_over': 'ಸೆಟ್ ಮಾಡಿದ್ದಕ್ಕಿಂತ ಹೆಚ್ಚು ಪರೀಕ್ಷಿಸಲಾಗಿದೆ',
  'err_removed_over': 'ತೆಗೆದ ಮೊಟ್ಟೆಗಳು ಸೆಟ್ ಮಾಡಿದ್ದಕ್ಕಿಂತ ಹೆಚ್ಚು', 'err_dead_over': 'ಸತ್ತ ಭ್ರೂಣಗಳು ಪರೀಕ್ಷಿಸಿದ ಮೊಟ್ಟೆಗಳಿಗಿಂತ ಹೆಚ್ಚು',
  'err_line_over': 'ಡೆಲಿವರಿ + ಕಡಿಮೆ ಲೋಡ್‌ಗಿಂತ ಹೆಚ್ಚು', 'err_doa_over': 'DOA ಡೆಲಿವರಿಗಿಂತ ಹೆಚ್ಚು',
  'stage1': 'ಕ್ಯಾಂಡ್ಲಿಂಗ್ ದಿನ 10', 'stage2': 'ಕ್ಯಾಂಡ್ಲಿಂಗ್ ದಿನ 18', 'both_done': 'ಈ ಸೆಟ್ಟಿಂಗ್‌ಗೆ ಎರಡೂ ಕ್ಯಾಂಡ್ಲಿಂಗ್ ದಾಖಲಾಗಿದೆ.',
  'eggs_candled': 'ಪರೀಕ್ಷಿಸಿದ ಮೊಟ್ಟೆಗಳು', 'infertile': 'ಫಲವತ್ತಾಗದವು', 'early_dead': 'ಮೊದಲೇ ಸತ್ತವು', 'mid_dead': 'ಮಧ್ಯದಲ್ಲಿ ಸತ್ತವು', 'late_dead': 'ತಡವಾಗಿ ಸತ್ತವು',
  'chicks_a': 'ಮರಿಗಳು ಗ್ರೇಡ್ A', 'chicks_b': 'ಮರಿಗಳು ಗ್ರೇಡ್ B', 'culls': 'ಕಲ್ಸ್', 'dead_in_hatcher': 'ಹ್ಯಾಚರ್‌ನಲ್ಲಿ ಸತ್ತವು', 'unhatched': 'ಹೊರಬಾರದವು',
  'no_trips': 'ರಸ್ತೆಯಲ್ಲಿ ಟ್ರಿಪ್‌ಗಳಿಲ್ಲ.', 'loaded': 'ಲೋಡ್', 'delivered': 'ಡೆಲಿವರಿ', 'short': 'ಕಡಿಮೆ', 'doa': 'DOA',
  'receiver': 'ಸ್ವೀಕರಿಸಿದವರು', 'photo': 'ಪುರಾವೆ ಫೋಟೋ', 'mark_delivered': 'ಡೆಲಿವರಿ ಆಯಿತು ಎಂದು ಗುರುತಿಸಿ', 'retry': 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', 'delivered_ok': 'ಟ್ರಿಪ್ ಡೆಲಿವರಿ ಆಯಿತು',
};

const i18nTables = {'en': _en, 'te': _te, 'hi': _hi, 'ta': _ta, 'kn': _kn};

String trLang(String lang, String key) => i18nTables[lang]?[key] ?? _en[key] ?? key;

String tr(BuildContext context, String key) => trLang(Localizations.localeOf(context).languageCode, key);

/// DB trigger errors ("rejects (12) exceed nest eggs (10)") are shown as-is.
String errText(Object e) => e is PostgrestException ? e.message : '$e';
