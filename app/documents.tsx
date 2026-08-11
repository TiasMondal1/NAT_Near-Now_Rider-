import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { getSession } from "../session";
import {
  DOC_NUMBER_FORMATS,
  DOC_NUMBER_LENGTHS,
  deleteVerificationDocument,
  docNumberErrorMessage,
  fetchVerificationDocuments,
  formatPickedFileSize,
  isVehicleRegistrationRequired,
  saveVerificationDocument,
  validateDocNumber,
  type PickedDocFile,
  type RequiredDocKey,
  type VehicleType,
  type VerificationDocument,
} from "../lib/riderVerificationDocuments";
import { fetchRiderProfile } from "../lib/riderVerification";
import { peekRiderVerification } from "../lib/riderVerificationCache";
import VerificationNavBar from "../components/VerificationNavBar";

const DOCUMENT_SECTIONS = [
  { key: "aadhaar_front", label: "Aadhaar Card (Front)", icon: "card-account-details-outline" as const, placeholder: "12-digit Aadhaar number", hasNumber: true },
  { key: "aadhaar_back", label: "Aadhaar Card (Back)", icon: "card-account-details-outline" as const, placeholder: "", hasNumber: false },
  { key: "pan_front", label: "PAN Card (Front)", icon: "card-outline" as const, placeholder: "10-character PAN, e.g. ABCDE1234F", hasNumber: true },
  { key: "pan_back", label: "PAN Card (Back)", icon: "card-outline" as const, placeholder: "", hasNumber: false },
  { key: "driving_license_front", label: "Driving License (Front)", icon: "card-text-outline" as const, placeholder: "Driving license number", hasNumber: true },
  { key: "driving_license_back", label: "Driving License (Back)", icon: "card-text-outline" as const, placeholder: "", hasNumber: false },
  { key: "vehicle_registration", label: "Vehicle Registration (RC)", icon: "file-document-outline" as const, placeholder: "Vehicle registration number", hasNumber: true },
  { key: "vehicle_photo_front", label: "Vehicle Photo (Front)", icon: "motorbike" as const, placeholder: "", hasNumber: false },
  { key: "vehicle_photo_side", label: "Vehicle Photo (Side)", icon: "motorbike" as const, placeholder: "", hasNumber: false },
  { key: "vehicle_photo_rear", label: "Vehicle Photo (Rear)", icon: "motorbike" as const, placeholder: "", hasNumber: false },
] as const;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const FORMATS_DISCLAIMER = "Accepted formats: JPG, PNG, WEBP, PDF · Max size 5MB";

type DocKey = RequiredDocKey;
type DocsState = Record<DocKey, VerificationDocument | null>;

const SECTION_BY_KEY = Object.fromEntries(
  DOCUMENT_SECTIONS.map((s) => [s.key, s])
) as Record<DocKey, (typeof DOCUMENT_SECTIONS)[number]>;

const EMPTY_DOCS = (): DocsState =>
  Object.fromEntries(DOCUMENT_SECTIONS.map((d) => [d.key, null])) as DocsState;

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return "jpg";
}

/**
 * Aadhaar and PAN each combine their front/back keys into one card (shared
 * header, one Document Number field from the front side). Driving License
 * does the same. Vehicle Registration is a single-key group, only shown when
 * the selected vehicle type actually requires it (bike/scooty). Vehicle
 * Photos is a 3-key group (front/side/rear), shown unconditionally for every
 * vehicle type — even cycle/e-bike riders, who skip Vehicle Registration,
 * still need it.
 */
type DocGroup = {
  groupKey: string;
  headerLabel: string;
  headerIcon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  numberKey: DocKey | null;
  members: readonly DocKey[];
};

const ALL_GROUPS: DocGroup[] = [
  { groupKey: "aadhaar", headerLabel: "Aadhaar Card", headerIcon: "card-account-details-outline", numberKey: "aadhaar_front", members: ["aadhaar_front", "aadhaar_back"] },
  { groupKey: "pan", headerLabel: "PAN Card", headerIcon: "card-outline", numberKey: "pan_front", members: ["pan_front", "pan_back"] },
  { groupKey: "driving_license", headerLabel: "Driving License", headerIcon: "card-text-outline", numberKey: "driving_license_front", members: ["driving_license_front", "driving_license_back"] },
  { groupKey: "vehicle_registration", headerLabel: "Vehicle Registration (RC)", headerIcon: "file-document-outline", numberKey: "vehicle_registration", members: ["vehicle_registration"] },
  { groupKey: "vehicle_photos", headerLabel: "Vehicle Photos", headerIcon: "motorbike", numberKey: null, members: ["vehicle_photo_front", "vehicle_photo_side", "vehicle_photo_rear"] },
];

// Seeds serverDocs/numbers from a documents list — shared by the initial
// (possibly cached) state and the real fetch, so both build the same shape.
function docsToState(docs: VerificationDocument[]): { docs: DocsState; numbers: Record<DocKey, string> } {
  const next = EMPTY_DOCS();
  const nextNumbers = Object.fromEntries(DOCUMENT_SECTIONS.map((d) => [d.key, ""])) as Record<DocKey, string>;
  for (const doc of docs) {
    next[doc.doc_type] = doc;
    nextNumbers[doc.doc_type] = doc.number ?? "";
  }
  return { docs: next, numbers: nextNumbers };
}

export default function DocumentsScreen() {
  const router = useRouter();
  // Seed from the same cache useRiderVerificationGate populates, so a rider
  // who already visited this session (via the verification nav bar) sees
  // real content immediately instead of a blank spinner — the effect below
  // still re-fetches fresh data in the background regardless.
  const cached = peekRiderVerification();
  const cachedSeed = cached ? docsToState(cached.documents) : null;
  const [loading, setLoading] = useState(!cached);
  const [token, setToken] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(
    (cached?.profile?.vehicle_type as VehicleType | null) ?? null
  );
  const [serverDocs, setServerDocs] = useState<DocsState>(cachedSeed?.docs ?? EMPTY_DOCS());
  const [numbers, setNumbers] = useState<Record<DocKey, string>>(
    cachedSeed?.numbers ?? (Object.fromEntries(DOCUMENT_SECTIONS.map((d) => [d.key, ""])) as Record<DocKey, string>)
  );
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<DocKey, PickedDocFile>>>({});
  const [savingKey, setSavingKey] = useState<DocKey | null>(null);
  const [saving, setSaving] = useState(false);
  // Distinct from `doc.status === "rejected"` (an admin review outcome) —
  // this tracks a failed *save* attempt during handleSaveAll's batch, so a
  // card that failed to upload keeps a visible marker after its one-shot
  // Alert is dismissed, instead of looking identical to an untouched card.
  const [failedKeys, setFailedKeys] = useState<Set<DocKey>>(new Set());
  const suspendedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) {
        router.replace("/phone");
        return;
      }
      setToken(session.token);
      try {
        const [profile, docs] = await Promise.all([
          fetchRiderProfile(session.token),
          fetchVerificationDocuments(session.token),
        ]);
        setVehicleType((profile?.vehicle_type as VehicleType | null) ?? null);
        const { docs: next, numbers: nextNumbers } = docsToState(docs);
        setServerDocs(next);
        setNumbers(nextNumbers);
      } catch {
        /* non-fatal — screen still renders with empty state */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = ALL_GROUPS.filter(
    (g) => g.groupKey !== "vehicle_registration" || isVehicleRegistrationRequired(vehicleType)
  );

  const applyPickedImage = (key: DocKey, asset: ImagePicker.ImagePickerAsset) => {
    const mimeType = asset.mimeType || "image/jpeg";
    if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE_BYTES) {
      Alert.alert("File too large", FORMATS_DISCLAIMER);
      return;
    }
    setPendingFiles((prev) => ({
      ...prev,
      [key]: {
        uri: asset.uri,
        name: asset.fileName || `${key}.${extFromMime(mimeType)}`,
        type: mimeType,
        size: asset.fileSize,
      },
    }));
    setFailedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const pickImage = async (key: DocKey) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to upload documents.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    applyPickedImage(key, result.assets[0]);
  };

  const takePhoto = async (key: DocKey) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    applyPickedImage(key, result.assets[0]);
  };

  const pickPdf = async (key: DocKey) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.size && asset.size > MAX_FILE_SIZE_BYTES) {
      Alert.alert("File too large", FORMATS_DISCLAIMER);
      return;
    }
    setPendingFiles((prev) => ({
      ...prev,
      [key]: { uri: asset.uri, name: asset.name || "document.pdf", type: "application/pdf", size: asset.size },
    }));
    setFailedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // Every document, including the 3 vehicle photos, offers a choice between
  // an image and a PDF via pickerSheetKey below.
  const [pickerSheetKey, setPickerSheetKey] = useState<DocKey | null>(null);
  const handleUploadPress = (key: DocKey) => {
    setPickerSheetKey(key);
  };

  const saveOne = async (key: DocKey): Promise<VerificationDocument | null> => {
    if (!token) return null;
    // `autoCapitalize="characters"` on the input is only a keyboard hint —
    // paste/autofill can still land lowercase characters in state — so the
    // value that gets format-validated and the value that gets persisted
    // must be the same normalized (uppercased) string, not two different
    // ones computed separately.
    const number = numbers[key]?.trim().toUpperCase();
    const file = pendingFiles[key];
    const current = serverDocs[key];
    if (!file && (number ?? "") === (current?.number ?? "")) return current; // nothing changed

    if (number && !validateDocNumber(key, number)) {
      Alert.alert("Invalid number", docNumberErrorMessage(key));
      return current;
    }

    setSavingKey(key);
    try {
      const res = await saveVerificationDocument(token, key, {
        number: number || undefined,
        file,
      });
      if (!res.ok) {
        setFailedKeys((prev) => new Set(prev).add(key));
        Alert.alert("Upload failed", res.error);
        return current;
      }
      setFailedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const mergedDoc = { ...res.document, url: res.document.url ?? current?.url ?? file?.uri ?? null };
      setServerDocs((prev) => ({ ...prev, [key]: mergedDoc }));
      setPendingFiles((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (res.riderSuspended) suspendedRef.current = true;
      return mergedDoc;
    } catch (e) {
      setFailedKeys((prev) => new Set(prev).add(key));
      throw e;
    } finally {
      setSavingKey(null);
    }
  };

  const deleteOne = (key: DocKey) => {
    const doc = serverDocs[key];
    if (!doc?.url) return;
    Alert.alert(
      "Delete document",
      doc.status === "approved"
        ? "This document is already approved — deleting it means your account will be sent back for re-verification. Continue?"
        : "This removes the uploaded file. You can upload a new one anytime.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            setSavingKey(key);
            try {
              const res = await deleteVerificationDocument(token, key);
              if (!res.ok) {
                Alert.alert("Delete failed", res.error);
                return;
              }
              setServerDocs((prev) => ({ ...prev, [key]: null }));
              setNumbers((prev) => ({ ...prev, [key]: "" }));
              setPendingFiles((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              if (res.riderSuspended) {
                Alert.alert(
                  "Sent back for re-verification",
                  "Editing an approved document means your account needs to be re-verified before you can go online again.",
                  [{ text: "OK", onPress: () => router.replace("/pending-verification") }]
                );
              }
            } finally {
              setSavingKey(null);
            }
          },
        },
      ]
    );
  };

  const handleSaveAll = async () => {
    if (!vehicleType) {
      Alert.alert(
        "Vehicle type missing",
        "Your account is missing a vehicle type. Please contact support to resolve this before submitting."
      );
      return;
    }
    setSaving(true);
    suspendedRef.current = false;
    try {
      const keysToSave = groups.flatMap((g) => g.members);
      const results: Partial<Record<DocKey, VerificationDocument | null>> = {};
      for (const key of keysToSave) {
        results[key] = await saveOne(key);
      }
      if (suspendedRef.current) {
        Alert.alert(
          "Sent back for re-verification",
          "Editing an approved document means your account needs to be re-verified.",
          [{ text: "OK", onPress: () => router.replace("/pending-verification") }]
        );
        return;
      }
      const anySubmitted = keysToSave.every((k) => !!results[k]?.url);
      Alert.alert(
        "Saved",
        anySubmitted
          ? "Your documents have been submitted. Our team will verify them before you can go online."
          : "Upload the remaining documents to complete verification.",
        anySubmitted
          ? [{ text: "OK", onPress: () => router.replace("/billing-info") }]
          : undefined
      );
    } catch {
      Alert.alert("Error", "Failed to save one or more documents. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  type StatusBadge = { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; text: string; color: string };

  const computeGroupStatus = (group: DocGroup): StatusBadge | null => {
    const rejectedAny = group.members.some(
      (k) => !pendingFiles[k] && serverDocs[k]?.status === "rejected"
    );
    if (rejectedAny) return { icon: "close-circle", text: "Needs re-upload", color: Colors.danger };

    const pendingFileAny = group.members.some((k) => !!pendingFiles[k]);
    if (pendingFileAny) return { icon: "check-circle-outline", text: "Ready to save", color: Colors.accent };

    // A member with no file uploaded at all yet is still on the rider's side,
    // not the admin's — check this before "Verified"/"Pending review" below.
    const missingAny = group.members.some((k) => !serverDocs[k]?.url);
    if (missingAny) return null;

    const allApproved = group.members.every((k) => serverDocs[k]?.status === "approved");
    if (allApproved) return { icon: "check-circle", text: "Verified", color: Colors.success };

    return { icon: "clock-outline", text: "Pending review", color: Colors.warning };
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ animation: "fade" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ animation: "fade" }} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <VerificationNavBar active="documents" />

        <View style={styles.notice}>
          <MaterialCommunityIcons name="shield-lock-outline" size={22} color={Colors.accent} />
          <Text style={styles.noticeText}>
            After you submit, your account stays locked until an admin approves these documents.
          </Text>
        </View>

        {groups.map((group) => {
          const status = computeGroupStatus(group);
          const numberSection = group.numberKey ? SECTION_BY_KEY[group.numberKey] : null;

          return (
            <View key={group.groupKey} style={styles.card}>
              <View style={styles.sectionHeading}>
                <View style={styles.iconBadge}>
                  <MaterialCommunityIcons name={group.headerIcon} size={18} color={Colors.accent} />
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>{group.headerLabel}</Text>
                  <Text style={styles.sectionDescription}>
                    {status ? status.text : "Required for verification"}
                  </Text>
                </View>
                {status && (
                  <View style={[styles.statusBadge, { backgroundColor: status.color + "15" }]}>
                    <MaterialCommunityIcons name={status.icon} size={14} color={status.color} />
                    <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.text}</Text>
                  </View>
                )}
              </View>

              {numberSection && (
                <>
                  <Text style={styles.inputLabel}>
                    {group.groupKey === "vehicle_registration" ? "Vehicle Registration Number" : "Document Number"}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={numbers[numberSection.key]}
                    onChangeText={(text) => setNumbers((prev) => ({ ...prev, [numberSection.key]: text }))}
                    placeholder={numberSection.placeholder}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="characters"
                  />
                  {group.groupKey === "vehicle_registration" && (
                    <Text style={styles.formatHintText}>This also sets the Vehicle Number shown on your profile.</Text>
                  )}
                  {(() => {
                    const format = DOC_NUMBER_FORMATS[numberSection.key];
                    if (!format) return null;
                    const expectedLength = DOC_NUMBER_LENGTHS[numberSection.key];
                    const currentLength = numbers[numberSection.key]?.length ?? 0;
                    const mismatch = !!expectedLength && currentLength > 0 && currentLength !== expectedLength;
                    return (
                      <Text style={mismatch ? styles.lengthWarning : styles.formatHintText}>
                        {mismatch
                          ? `${currentLength > expectedLength! ? "Too long" : "Too short"} — expected ${format.description} (currently ${currentLength} characters).`
                          : `Format: ${format.description}. Example: ${format.example}`}
                      </Text>
                    );
                  })()}
                </>
              )}

              {group.members.map((memberKey, idx) => {
                const memberSection = SECTION_BY_KEY[memberKey];
                const doc = serverDocs[memberKey];
                const pendingFile = pendingFiles[memberKey];
                const isSavingThis = savingKey === memberKey;
                const previewUri = pendingFile?.uri ?? doc?.url ?? null;
                const isMultiMember = group.members.length > 1;
                const isPdf = pendingFile
                  ? pendingFile.type === "application/pdf"
                  : !!doc?.url?.toLowerCase().includes(".pdf");

                return (
                  <View key={memberKey} style={idx > 0 ? styles.memberBlockSpaced : undefined}>
                    {isMultiMember ? (
                      <Text style={[styles.memberHeader, idx === 0 && styles.memberHeaderFirst]}>
                        {memberSection.label}
                      </Text>
                    ) : (
                      <Text style={[styles.inputLabel, { marginTop: numberSection ? Spacing.md : 0 }]}>
                        Document File
                      </Text>
                    )}

                    {!pendingFile && doc?.status === "rejected" && doc?.rejection_reason ? (
                      <View style={styles.rejectionBanner}>
                        <MaterialCommunityIcons name="alert-circle" size={14} color={Colors.danger} />
                        <Text style={styles.rejectionText}>{doc.rejection_reason}</Text>
                      </View>
                    ) : null}

                    {failedKeys.has(memberKey) && (
                      <View style={styles.rejectionBanner}>
                        <MaterialCommunityIcons name="alert-circle" size={14} color={Colors.danger} />
                        <Text style={styles.rejectionText}>Failed to save — tap below to retry</Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.uploadArea,
                        (pendingFile || doc?.url) && styles.uploadAreaFilled,
                        failedKeys.has(memberKey) && styles.uploadAreaFailed,
                      ]}
                      activeOpacity={0.8}
                      onPress={() => handleUploadPress(memberKey)}
                      disabled={isSavingThis}
                    >
                      {isSavingThis ? (
                        <ActivityIndicator color={Colors.accent} />
                      ) : previewUri ? (
                        isPdf ? (
                          <View style={styles.pdfChip}>
                            <MaterialCommunityIcons name="file-document" size={28} color={Colors.accent} />
                            <Text style={styles.pdfChipText} numberOfLines={1}>
                              {pendingFile?.name || "Document.pdf"}
                            </Text>
                          </View>
                        ) : (
                          <>
                            <Image source={{ uri: previewUri }} style={styles.preview} />
                            <View style={styles.changeOverlay}>
                              <MaterialCommunityIcons name="camera" size={16} color="#fff" />
                              <Text style={styles.changeText}>Change</Text>
                            </View>
                          </>
                        )
                      ) : (
                        <>
                          <View style={styles.uploadIcon}>
                            <MaterialCommunityIcons name="image-plus" size={24} color={Colors.accent} />
                          </View>
                          <Text style={styles.uploadTitle}>Upload {memberSection.label}</Text>
                          <Text style={styles.uploadHint}>{FORMATS_DISCLAIMER}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {(pendingFile || doc?.url) && (
                      <View style={styles.fileMetaRow}>
                        <Text style={styles.formatsHint}>{FORMATS_DISCLAIMER}</Text>
                        {(() => {
                          const sizeLabel = pendingFile?.size
                            ? formatPickedFileSize(pendingFile.size)
                            : doc?.file_size ?? null;
                          return sizeLabel ? <Text style={styles.fileSizeText}>{sizeLabel}</Text> : null;
                        })()}
                      </View>
                    )}
                    {doc?.url && (
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        activeOpacity={0.7}
                        onPress={() => deleteOne(memberKey)}
                        disabled={isSavingThis}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={14} color={Colors.danger} />
                        <Text style={styles.deleteBtnText}>Delete uploaded file</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.submitButton, saving && styles.disabled]}
          onPress={handleSaveAll}
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

      <Modal
        visible={pickerSheetKey !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerSheetKey(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerSheetKey(null)}
        >
          <TouchableOpacity style={styles.pickerCard} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Upload document</Text>
            <TouchableOpacity
              style={styles.pickerOption}
              activeOpacity={0.7}
              onPress={() => {
                const key = pickerSheetKey;
                setPickerSheetKey(null);
                if (key) takePhoto(key);
              }}
            >
              <MaterialCommunityIcons name="camera-outline" size={20} color={Colors.accent} />
              <Text style={styles.pickerOptionText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerOption}
              activeOpacity={0.7}
              onPress={() => {
                const key = pickerSheetKey;
                setPickerSheetKey(null);
                if (key) pickImage(key);
              }}
            >
              <MaterialCommunityIcons name="image-outline" size={20} color={Colors.accent} />
              <Text style={styles.pickerOptionText}>Choose Image</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerOption}
              activeOpacity={0.7}
              onPress={() => {
                const key = pickerSheetKey;
                setPickerSheetKey(null);
                if (key) pickPdf(key);
              }}
            >
              <MaterialCommunityIcons name="file-pdf-box" size={20} color={Colors.accent} />
              <Text style={styles.pickerOptionText}>Upload PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerCancelBtn}
              activeOpacity={0.7}
              onPress={() => setPickerSheetKey(null)}
            >
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  sectionHeading: { flexDirection: "row", alignItems: "center", marginBottom: Spacing.md, gap: Spacing.sm },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentLight,
  },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: Colors.text, fontSize: 15, fontWeight: "700" },
  sectionDescription: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
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
    marginBottom: 4,
  },
  formatHintText: { color: Colors.textMuted, fontSize: 11, fontWeight: "500", marginBottom: Spacing.sm },
  lengthWarning: { color: Colors.danger, fontSize: 11, fontWeight: "600", marginBottom: Spacing.sm },
  memberHeader: { color: Colors.text, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  memberHeaderFirst: { marginTop: Spacing.sm },
  memberBlockSpaced: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  rejectionBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: Colors.dangerLight,
    borderWidth: 1,
    borderColor: Colors.danger + "30",
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  rejectionText: { color: Colors.danger, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 16 },
  uploadArea: {
    height: 130,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  uploadAreaFilled: { borderStyle: "solid", borderColor: Colors.accent + "50" },
  uploadAreaFailed: { borderStyle: "solid", borderColor: Colors.danger + "60" },
  uploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentLight,
    marginBottom: Spacing.sm,
  },
  uploadTitle: { color: Colors.text, fontSize: 13, fontWeight: "700" },
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
  pdfChip: { alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: Spacing.lg },
  pdfChipText: { color: Colors.text, fontSize: 13, fontWeight: "600" },
  fileMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  formatsHint: { color: Colors.textMuted, fontSize: 10 },
  fileSizeText: { color: Colors.textMuted, fontSize: 10, fontWeight: "600" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: Spacing.sm, alignSelf: "flex-start" },
  deleteBtnText: { color: Colors.danger, fontSize: 12, fontWeight: "600" },
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

  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  pickerCard: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  pickerTitle: { fontSize: 16, fontWeight: "800", color: Colors.text, paddingBottom: Spacing.md, marginBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  pickerOption: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: Spacing.md },
  pickerOptionText: { fontSize: 15, fontWeight: "600", color: Colors.text },
  pickerCancelBtn: { marginTop: Spacing.sm, paddingVertical: Spacing.md, alignItems: "center" },
  pickerCancelText: { fontSize: 15, fontWeight: "600", color: Colors.textMuted },
});
