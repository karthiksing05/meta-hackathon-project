import Foundation

// Muse Studio falls back to composing on device when the network or Muse fails. Both real
// services can do that, so Studio's "Make it offline" path works with either one.
extension MuseStudioService: StudioOfflineComposing {}
extension OfflineStudioService: StudioOfflineComposing {}
