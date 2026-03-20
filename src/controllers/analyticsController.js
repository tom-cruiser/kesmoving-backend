const Booking = require('../models/Booking');
const User = require('../models/User');
const Truck = require('../models/Truck');
const Review = require('../models/Review');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @route   GET /api/analytics/overview
 * @access  Private/Admin, OperationsManager
 */
const getOverview = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const bookingFilter = Object.keys(dateFilter).length ? { moveDate: dateFilter } : {};

  const [
    totalBookings,
    bookingsByStatus,
    totalClients,
    totalStaff,
    trucksAvailable,
    trucksInUse,
    avgRating,
    recentBookings,
    revenueData,
  ] = await Promise.all([
    Booking.countDocuments(bookingFilter),
    Booking.aggregate([
      { $match: bookingFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ role: 'Client' }),
    User.countDocuments({ role: { $ne: 'Client' }, isActive: true }),
    Truck.countDocuments({ status: 'Available' }),
    Truck.countDocuments({ status: 'InUse' }),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: '$ratings.overall' } } }]),
    Booking.find(bookingFilter)
      .populate('client', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('bookingNumber status moveDate client pickupAddress destinationAddress'),
    Booking.aggregate([
      { $match: { ...bookingFilter, 'payment.status': 'Paid' } },
      { $group: { _id: null, total: { $sum: '$payment.amount' } } },
    ]),
  ]);

  const statusMap = bookingsByStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {});

  res.json({
    success: true,
    data: {
      totalBookings: totalBookings,
      totalRevenue: revenueData[0]?.total || 0,
      totalClients,
      totalStaff,
      avgRating: avgRating[0]?.avg ? Math.round(avgRating[0].avg * 10) / 10 : null,
      completedBookings: statusMap.Completed || 0,
      statusBreakdown: statusMap,
      fleet: { available: trucksAvailable, inUse: trucksInUse },
      recentBookings,
    },
  });
});

/**
 * @route   GET /api/analytics/bookings/trend
 * @access  Private/Admin, OperationsManager
 */
const getBookingTrend = asyncHandler(async (req, res) => {
  const { period = 'monthly', year } = req.query;
  const targetYear = year ? parseInt(year) : new Date().getFullYear();

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const trend = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: new Date(`${targetYear}-01-01`), $lte: new Date(`${targetYear}-12-31`) },
      },
    },
    {
      $group: {
        _id: period === 'monthly' ? { $month: '$createdAt' } : { $week: '$createdAt' },
        bookings: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $eq: ['$payment.status', 'Paid'] }, '$payment.amount', 0] } },
        avgLoadingTime: { $avg: '$aiEstimate.loadingTime' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const normalized = trend.map((t) => ({
    month: period === 'monthly' ? MONTHS[t._id - 1] : `W${t._id}`,
    bookings: t.bookings,
    revenue: t.revenue,
    avgLoadingTime: t.avgLoadingTime ? Math.round(t.avgLoadingTime * 10) / 10 : null,
  }));

  res.json({ success: true, data: normalized });
});

/**
 * @route   GET /api/analytics/staff/performance
 * @access  Private/Admin, OperationsManager
 */
const getStaffPerformance = asyncHandler(async (req, res) => {
  const performance = await Booking.aggregate([
    { $match: { status: 'Completed' } },
    { $unwind: '$crewAssignment.movers' },
    {
      $group: {
        _id: '$crewAssignment.movers',
        completedMoves: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
        role: '$user.role',
        completedMoves: 1,
      },
    },
    { $sort: { completedMoves: -1 } },
    { $limit: 20 },
  ]);

  res.json({ success: true, data: performance });
});

module.exports = { getOverview, getBookingTrend, getStaffPerformance };
