const populationValueLabels = {
  id: "populationValueLabels",

  afterDatasetsDraw(chartInstance) {
    if (chartInstance.canvas.id !== "poblaciones") return;

    const { ctx, data, chartArea } = chartInstance;
    ctx.save();
    ctx.font = "600 10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    data.datasets.forEach((dataset, datasetIndex) => {
      const metadata = chartInstance.getDatasetMeta(datasetIndex);
      if (metadata.hidden) return;

      metadata.data.forEach((bar, dataIndex) => {
        const valueM3 = Math.round(Number(dataset.data[dataIndex]));
        if (!Number.isFinite(valueM3)) return;

        const label = valueM3.toLocaleString("es-ES", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
          useGrouping: true,
        });

        const textWidth = ctx.measureText(label).width;
        let x = bar.x + 6;

        if (x + textWidth > chartArea.right - 2) {
          x = bar.x - textWidth - 6;
          ctx.fillStyle = "#ffffff";
        } else {
          ctx.fillStyle = "#475569";
        }

        ctx.fillText(label, x, bar.y);
      });
    });

    ctx.restore();
  },
};

Chart.register(populationValueLabels);
