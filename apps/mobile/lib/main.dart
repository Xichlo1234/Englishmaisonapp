import 'package:material_ui/material_ui.dart';

/// Ứng dụng di động Quản lý lớp học (Android/iOS).
/// Khung dự án — các màn hình được xây dựng ở Giai đoạn 4 (xem docs/PHASE1_DESIGN.md §8).
void main() {
  runApp(const EcmApp());
}

class EcmApp extends StatelessWidget {
  const EcmApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Quản lý lớp học',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Ứng dụng đang được phát triển (Giai đoạn 4).',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
