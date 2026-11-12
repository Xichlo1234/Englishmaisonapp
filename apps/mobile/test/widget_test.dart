import 'package:flutter_test/flutter_test.dart';
import 'package:ecm_mobile/main.dart';

void main() {
  testWidgets('Khung ứng dụng khởi động được', (tester) async {
    await tester.pumpWidget(const EcmApp());
    expect(find.textContaining('Giai đoạn 4'), findsOneWidget);
  });
}
