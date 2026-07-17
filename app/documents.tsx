import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";

type DocumentKind = "aadhaar" | "pan";
type VehicleType = "bike" | "cycle" | "ev_scooty";
type PickedDocument = {
  uri: string;
  base64: string;
  mimeType: string;
};

const VEHICLES: { value: VehicleType; label: string; icon: string }[] = [
  { value: "bike", label: "Bike", icon: "motorbike" },
  { value: "cycle", label: "Cycle", icon: "bike" },
  { value: "ev_scooty", label: "EV Scooty", icon: "scooter-electric" },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const [aadhaar, setAadhaar] = useState<PickedDocument | null>(null);
  const [pan, setPan] = useState<PickedDocument | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>("bike");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const pickDocument = async (kind: DocumentKind) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to upload your documents.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;

    const document = {
      uri: asset.uri,
      base64: asset.base64,
      mimeType: asset.mimeType || "image/jpeg",
    };
    if (kind === "aadhaar") setAadhaar(document);
    else setPan(document);
  };

  const selectVehicle = (value: VehicleType) => {
    setVehicleType(value);
    if (value !== "bike") setRegistrationNumber("");
  };

  const handleSubmit = async () => {
    if (!aadhaar || !pan) {
      Alert.alert("Documents required", "Please upload both your Aadhaar card and PAN card.");
      return;
    }
    if (vehicleType === "bike" && !registrationNumber.trim()) {
      Alert.alert("Registration required", "Please enter your bike registration number.");
      return;
    }

    setSaving(true);
    try {
      const session = await getSession();
      if (!session?.token) {
        Alert.alert("Session expired", "Please log in again.");
        return;
      }

      await apiFetch(
        "/delivery-partner/documents",
        {
          method: "PATCH",
          body: {
            aadhaar_image_base64: aadhaar.base64,
            aadhaar_mime_type: aadhaar.mimeType,
            pan_image_base64: pan.base64,
            pan_mime_type: pan.mimeType,
            vehicle_type: vehicleType,
            registration_number:
              vehicleType === "bike" ? registrationNumber.trim().toUpperCase() : null,
          },
        },
        session.token
      );

      Alert.alert("Documents submitted", "Your documents have been sent for verification.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Could not upload your documents. Please try again.";
      Alert.alert("Upload failed", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Upload Documents</Text>
            <Text style={styles.subtitle}>Complete your verification details</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.notice}>
            <MaterialCommunityIcons name="shield-lock-outline" size={22} color={Colors.accent} />
            <Text style={styles.noticeText}>
              Your documents are securely submitted and used only for account verification.
            </Text>
          </View>

          <UploadSection
            number="1"
            title="Aadhaar Card"
            description="Upload a clear image of your Aadhaar card"
            document={aadhaar}
            onPress={() => pickDocument("aadhaar")}
          />

          <UploadSection
            number="2"
            title="PAN Card"
            description="Upload a clear image of your PAN card"
            document={pan}
            onPress={() => pickDocument("pan")}
          />

          <View style={styles.card}>
            <View style={styles.sectionHeading}>
              <View style={styles.numberBadge}>
                <Text style={styles.numberText}>3</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Vehicle Details</Text>
                <Text style={styles.sectionDescription}>Select the vehicle used for deliveries</Text>
              </View>
            </View>

            <View style={styles.vehicleGrid}>
              {VEHICLES.map((vehicle) => {
                const active = vehicleType === vehicle.value;
                return (
                  <TouchableOpacity
                    key={vehicle.value}
                    style={[styles.vehicleOption, active && styles.vehicleOptionActive]}
                    onPress={() => selectVehicle(vehicle.value)}
                    activeOpacity={0.8}
                  >
                    <MaterialCommunityIcons
                      name={vehicle.icon as any}
                      size={25}
                      color={active ? Colors.accent : Colors.textMuted}
                    />
                    <Text style={[styles.vehicleLabel, active && styles.vehicleLabelActive]}>
                      {vehicle.label}
                    </Text>
                    {active && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={16}
                        color={Colors.accent}
                        style={styles.vehicleCheck}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.inputLabel}>Registration Number</Text>
            {vehicleType === "bike" ? (
              <TextInput
                style={styles.input}
                value={registrationNumber}
                onChangeText={setRegistrationNumber}
                placeholder="e.g. MH12AB1234"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            ) : (
              <View style={styles.notApplicable}>
                <MaterialCommunityIcons name="minus-circle-outline" size={18} color={Colors.textMuted} />
                <Text style={styles.notApplicableText}>
                  Not applicable for {vehicleType === "cycle" ? "cycles" : "EV scooties"}
                </Text>
                <Text style={styles.nullText}>NULL</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitButton, saving && styles.disabled]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={Colors.accentText} />
            ) : (
              <>
                <MaterialCommunityIcons name="cloud-upload-outline" size={21} color={Colors.accentText} />
                <Text style={styles.submitText}>Submit Documents</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UploadSection({
  number,
  title,
  description,
  document,
  onPress,
}: {
  number: string;
  title: string;
  description: string;
  document: PickedDocument | null;
  onPress: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeading}>
        <View style={styles.numberBadge}>
          <Text style={styles.numberText}>{number}</Text>
        </View>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDescription}>{description}</Text>
        </View>
        {document && <MaterialCommunityIcons name="check-circle" size={22} color={Colors.success} />}
      </View>

      <TouchableOpacity
        style={[styles.uploadArea, document && styles.uploadAreaSelected]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        {document ? (
          <>
            <Image source={{ uri: document.uri }} style={styles.preview} />
            <View style={styles.changeOverlay}>
              <MaterialCommunityIcons name="image-edit-outline" size={17} color="#fff" />
              <Text style={styles.changeText}>Change image</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.uploadIcon}>
              <MaterialCommunityIcons name="image-plus" size={27} color={Colors.accent} />
            </View>
            <Text style={styles.uploadTitle}>Choose from gallery</Text>
            <Text style={styles.uploadHint}>JPG or PNG • Make sure all details are visible</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    marginRight: Spacing.md,
  },
  headerCopy: { flex: 1 },
  title: { color: Colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  scroll: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.md,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accent + "25",
  },
  noticeText: { flex: 1, color: Colors.accentDark, fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", marginBottom: Spacing.md },
  numberBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentLight,
    marginRight: Spacing.sm,
  },
  numberText: { color: Colors.accent, fontWeight: "800", fontSize: 13 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  sectionDescription: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  uploadArea: {
    height: 150,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  uploadAreaSelected: { borderStyle: "solid", borderColor: Colors.accent + "50" },
  uploadIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentLight,
    marginBottom: Spacing.sm,
  },
  uploadTitle: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  uploadHint: { color: Colors.textMuted, fontSize: 11, marginTop: 4, textAlign: "center" },
  preview: { width: "100%", height: "100%", resizeMode: "cover" },
  changeOverlay: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.68)",
    borderRadius: BorderRadius.round,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  vehicleGrid: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.lg },
  vehicleOption: {
    flex: 1,
    height: 88,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  vehicleOptionActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
  vehicleLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "600" },
  vehicleLabelActive: { color: Colors.accentDark },
  vehicleCheck: { position: "absolute", right: 6, top: 6 },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: 15,
  },
  notApplicable: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
  },
  notApplicableText: { flex: 1, color: Colors.textMuted, fontSize: 13 },
  nullText: { color: Colors.textMuted, fontSize: 11, fontWeight: "700" },
  submitButton: {
    height: 54,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.55 },
});
