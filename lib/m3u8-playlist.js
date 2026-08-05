function buildM3u8Content(tracks) {
  const lines = ['#EXTM3U'];

  for (const track of tracks) {
    const durationSec = Number.isFinite(track.duration) ? Math.round(track.duration) : -1;
    const label = track.artist ? `${track.artist} - ${track.title}` : track.title;
    lines.push(`#EXTINF:${durationSec},${label}`);
    lines.push(track.fileName);
  }

  return lines.join('\n') + '\n';
}

module.exports = { buildM3u8Content };
