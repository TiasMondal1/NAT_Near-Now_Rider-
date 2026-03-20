import { Platform, View, Text, StyleSheet } from "react-native";
import { Colors } from "../constants/theme";

let MapView: any;
let Marker: any;
let PROVIDER_GOOGLE: any;

if (Platform.OS !== "web") {
  const maps = require("react-native-maps");
  MapView = maps.default;
  Marker = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} else {
  MapView = ({ children, style, ...props }: any) => (
    <View style={[style, webStyles.container]}>
      <Text style={webStyles.text}>Map (native only)</Text>
      {children}
    </View>
  );
  Marker = (_props: any) => null;
  PROVIDER_GOOGLE = null;
}

const webStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});

export { MapView as default, Marker, PROVIDER_GOOGLE };
