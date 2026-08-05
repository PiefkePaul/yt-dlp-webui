function sanitizeLabelPart(value) {
  return value.replace(/[\r\n]+/g, ' ');
}

function buildM3u8Content(tracks) {
  const lines = ['#EXTM3U'];

  for (const track of tracks) {
    const durationSec = Number.isFinite(track.duration) ? Math.round(track.duration) : -1;
    const title = sanitizeLabelPart(track.title);
    const artist = track.artist ? sanitizeLabelPart(track.artist) : track.artist;
    const label = artist ? `${artist} - ${title}` : title;
    lines.push(`#EXTINF:${durationSec},${label}`);
    lines.push(track.fileName);
  }

  return lines.join('\n') + '\n';
}

module.exports = { buildM3u8Content };
