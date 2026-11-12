import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { captureException } from "../lib/crashReporting";

// An unhandled render exception anywhere in the tree previously crashed the
// whole app with no fallback UI — the rider was left staring at a blank/
// native crash screen mid-delivery, with no way back in except force-quitting
// and relaunching. This catches it and offers a retry instead.
type BoundaryState = { hasError: boolean; message: string; resetKey: number };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "", resetKey: 0 };
  }

  static getDerivedStateFromError(error: any): Partial<BoundaryState> {
    return {
      hasError: true,
      message: error?.message ?? String(error) ?? "Unknown error",
    };
  }

  componentDidCatch(error: any, info: any) {
    // Always log (not only in __DEV__): there is no crash reporter in this
    // app yet, so the device log is the only trace of a production crash.
    console.error("[ErrorBoundary]", error, info?.componentStack);
    captureException(error, { componentStack: info?.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.message}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            // Bumping the key remounts the children from scratch. Clearing
            // hasError alone re-rendered the same tree, which re-threw the
            // same deterministic error instantly and made Retry look dead.
            onPress={() => this.setState((s) => ({ hasError: false, message: "", resetKey: s.resetKey + 1 }))}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
    backgroundColor: Colors.bg,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.danger,
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
