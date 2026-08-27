function SignaturePad(canvas, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var drawing = false;
  var scaleX = 1, scaleY = 1;
  var current = [];

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scaleX = 1 / (rect.width || 1);
    scaleY = 1 / (rect.height || 1);
    ctx.lineWidth = opts.lineWidth || 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.color || '#000000';
  }

  function pos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function drawTo(p) {
    if (current.length < 2) return;
    var prev = current[current.length - 2];
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    current = [pos(e)];
    ctx.beginPath();
    ctx.moveTo(current[0].x, current[0].y);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pos(e);
    drawTo(p);
    current.push(p);
    if (opts.onStrokeProgress && current.length >= Math.max(2, Math.floor(current.length / 4) * 4 + 1)) {
      opts.onStrokeProgress(current);
    }
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!drawing) return;
    var p = pos(e);
    drawTo(p);
    current.push(p);
    drawing = false;
    if (opts.onStrokeEnd) opts.onStrokeEnd(current.slice());
    current = [];
  });

  canvas.addEventListener('pointercancel', function () {
    drawing = false;
    current = [];
  });

  function clearCanvas() {
    var rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }

  function dataUrl() {
    return canvas.toDataURL('image/png');
  }

  this.clear = clearCanvas;
  this.resize = resize;
  this.dataUrl = dataUrl;
  this.isEmpty = function () {
    var rect = canvas.getBoundingClientRect();
    var data = ctx.getImageData(0, 0, Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))).data;
    for (var i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
  };
}

function ScaleCanvas(canvas) {
  var ctx = canvas.getContext('2d');

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
  }

  function drawStroke(points) {
    if (!points || points.length < 2) return;
    var rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(points[0].x * rect.width, points[0].y * rect.height);
    for (var i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * rect.width, points[i].y * rect.height);
    }
    ctx.stroke();
  }

  this.resize = resize;
  this.drawStroke = drawStroke;
  this.clear = function () {
    var rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  };
}